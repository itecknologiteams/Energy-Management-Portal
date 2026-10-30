'use strict';

/**
 * Admin email portal: settings rules, confidentiality guards, admin login,
 * history, and the HTTP API end to end (database and SMTP are mocked).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// Isolate every file this test touches
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ems-admin-test-'));
process.env.FLEET_ALERTS_PATH = path.join(dir, 'fleet-alerts.json');
process.env.ALERT_DATA_DIR = dir;
process.env.ALERT_STATE_PATH = path.join(dir, 'alert-state.json');
process.env.ADMINS_PATH = path.join(dir, 'admins.json');
process.env.ALERTS_CONFIG_PATH = path.join(dir, 'alerts.json');
fs.writeFileSync(process.env.ALERTS_CONFIG_PATH, JSON.stringify({
  temperature: { enabled: true, defaultThresholdC: 90, vehicleThresholdsC: { 999: 80 } },
  monitor: { enabled: true, fleetIds: [] },
  email: {
    enabled: true, from: 'EMS <alerts@example.com>',
    recipients: { default: { to: ['ops@example.com'] }, byFleet: {} },
    smtp: { host: 'smtp.example.com', port: 587 },
  },
}));

// ── Mock the CRM / tracking databases and the mail server ────────────────────
const FLEETS = {
  100: [{ vehicleId: 11, vehicleName: 'A-GEN-1' }, { vehicleId: 12, vehicleName: 'A-GEN-2' }],
  200: [{ vehicleId: 21, vehicleName: 'B-GEN-1' }],
};
const src = (p) => require.resolve(path.join(__dirname, '..', 'src', p));
require.cache[src('repositories/fleetRepository')] = { exports: { getVehiclesByFleetId: async (id) => FLEETS[id] || [] } };
const { TrackingTableNotFoundError } = require('../src/utils/errors');
// Tracking rows carry local (PKT) wall-clock time, like the real database
let trackingRows = () => [{ timestamp: require('../src/services/alertService').dbClockNow().toISOString(), params: '{"72":655}' }];
require.cache[src('repositories/trackingRepository')] = { exports: {
  getTrackingData: async () => trackingRows(),
  TrackingTableNotFoundError,
} };
const sent = [];
let failNextSend = false;
require.cache[src('services/mailService')] = { exports: {
  sendMail: async (m) => {
    if (failNextSend) { failNextSend = false; throw new Error('550 mailbox unavailable'); }
    sent.push(m); return { messageId: `<m${sent.length}@test>`, accepted: m.to, rejected: [] };
  },
  verifyConnection: async () => true,
} };

const test = require('node:test');
const assert = require('node:assert/strict');
const settings = require('../src/services/fleetAlertSettings');
const adminAuth = require('../src/services/adminAuth');
const alertHistory = require('../src/services/alertHistory');
const { describeChanges } = require('../src/controllers/adminController');
const { getAlertConfig } = require('../src/config/alertConfig');

const quiet = (fn) => async (...a) => {
  const saved = ['log', 'warn', 'error'].map((k) => [k, console[k]]);
  saved.forEach(([k]) => { console[k] = () => {}; });
  try { return await fn(...a); } finally { saved.forEach(([k, f]) => { console[k] = f; }); }
};

// ═══ Settings validation ═════════════════════════════════════════════════════

test('addresses are cleaned, lower-cased and kept in only one list', () => {
  const { value, errors } = settings.validateFleetSettings({
    enabled: true,
    recipients: { to: [' Ops@Example.com ', 'ops@example.com'], cc: ['OPS@example.com', 'cc@example.com'], bcc: ['cc@example.com', 'hidden@example.com', ''] },
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(value.recipients, { to: ['ops@example.com'], cc: ['cc@example.com'], bcc: ['hidden@example.com'] });
});

test('bad input is rejected with clear messages', () => {
  const { errors } = settings.validateFleetSettings({
    enabled: true,
    recipients: { to: ['not-an-email', 'a@b'] },
    defaultThresholdC: 500,
    vehicleThresholdsC: { abc: 50, 12: -100 },
  });
  assert.ok(errors.some((e) => e.includes('"not-an-email" is not a valid')));
  assert.ok(errors.some((e) => e.includes('"a@b" is not a valid')));
  assert.ok(errors.some((e) => e.includes('Fleet temperature limit')));
  assert.ok(errors.some((e) => e.includes('"abc" is not a generator ID')));
  assert.ok(errors.some((e) => e.includes('generator 12')));
  assert.ok(errors.some((e) => e.includes('at least one recipient')));
});

test('a paused fleet may have no recipients; blank generator limits are cleared', () => {
  const { value, errors } = settings.validateFleetSettings({ enabled: false, vehicleThresholdsC: { 11: '', 12: '65' } });
  assert.deepEqual(errors, []);
  assert.deepEqual(value.vehicleThresholdsC, { 12: 65 });
});

// ═══ Storage, revisions, resolution ══════════════════════════════════════════

test('saving bumps the revision and rejects stale edits', quiet(() => {
  const a = settings.saveFleetSettings(100, { enabled: true, recipients: { to: ['a@fleet100.com'] } }, { expectedRevision: 0, actor: 't' });
  assert.equal(a.revision, 1);
  const b = settings.saveFleetSettings(100, { enabled: true, recipients: { to: ['a@fleet100.com'], bcc: ['hidden@fleet100.com'] } }, { expectedRevision: 1, actor: 't' });
  assert.equal(b.revision, 2);
  assert.throws(() => settings.saveFleetSettings(100, { enabled: true, recipients: { to: ['x@fleet100.com'] } }, { expectedRevision: 1, actor: 't' }),
    settings.RevisionConflictError);
  assert.ok(fs.readdirSync(path.join(dir, 'backups')).some((f) => f.startsWith('fleet-alerts-')), 'backup kept');
}));

test('recipients: own list only; paused → nobody; unknown fleet → nobody', quiet(() => {
  const cfg = getAlertConfig();
  assert.deepEqual(settings.resolveRecipients(100, cfg).to, ['a@fleet100.com']);
  assert.deepEqual(settings.resolveRecipients(100, cfg).bcc, ['hidden@fleet100.com']);
  settings.saveFleetSettings(200, { enabled: false }, { expectedRevision: 0, actor: 't' });
  const paused = settings.resolveRecipients(200, cfg);
  assert.equal(paused.to.length + paused.cc.length + paused.bcc.length, 0);
  const unknown = settings.resolveRecipients(300, cfg);
  assert.equal(unknown.to.length, 0, 'default list is not used unless explicitly allowed');
}));

test('monitored fleets are the enabled ones', () => {
  assert.deepEqual(settings.monitoredFleetIds(getAlertConfig()), [100]);
});

test('temperature limit order: generator → fleet → alerts.json generator → alerts.json default', quiet(() => {
  const cfg = getAlertConfig();
  settings.saveFleetSettings(100, {
    enabled: true, recipients: { to: ['a@fleet100.com'], bcc: ['hidden@fleet100.com'] },
    defaultThresholdC: 70, vehicleThresholdsC: { 11: 55 },
  }, { expectedRevision: 2, actor: 't' });
  assert.equal(settings.resolveThreshold(11, 100, cfg), 55);
  assert.equal(settings.resolveThreshold(12, 100, cfg), 70);
  assert.equal(settings.resolveThreshold(999, 300, cfg), 80);
  assert.equal(settings.resolveThreshold(12, 300, cfg), 90);
  assert.equal(settings.resolveThreshold(11, null, cfg), 55, 'fleet unknown → lowest generator limit');
}));

test('an address used by another fleet is detected', () => {
  assert.deepEqual(settings.findAddressConflicts(200, ['a@fleet100.com', 'new@x.com']), [{ address: 'a@fleet100.com', fleetIds: [100] }]);
  assert.deepEqual(settings.findAddressConflicts(100, ['a@fleet100.com']), [], 'own fleet is not a conflict');
});

test('change summary for the audit log', () => {
  const before = { enabled: true, label: '', recipients: { to: ['a@x.com'], cc: [], bcc: [] }, defaultThresholdC: null, vehicleThresholdsC: { 11: 60 } };
  const after = { enabled: false, label: 'TCM', recipients: { to: ['b@x.com'], cc: [], bcc: ['c@x.com'] }, defaultThresholdC: 70, vehicleThresholdsC: {} };
  assert.deepEqual(describeChanges(before, after), [
    'emails paused', 'label "TCM"', 'TO added b@x.com', 'TO removed a@x.com', 'BCC added c@x.com',
    'fleet limit server default → 70', 'generator 11 limit 60 → fleet limit',
  ]);
});

// ═══ Admin accounts and sessions ═════════════════════════════════════════════

test('password policy', () => {
  assert.throws(() => adminAuth.setAdminPassword('boss', 'short1'), /at least 10/);
  assert.throws(() => adminAuth.setAdminPassword('boss', 'onlyletters'), /letters and numbers/);
  assert.throws(() => adminAuth.setAdminPassword('Bad Name!', 'Password123'), /Username/);
});

test('login, token check, password change signs out old sessions', () => {
  adminAuth.resetForTests();
  assert.equal(adminAuth.setAdminPassword('Boss', 'Correct-horse-42').created, true);
  const stored = JSON.parse(fs.readFileSync(process.env.ADMINS_PATH, 'utf8')).users[0];
  assert.equal(stored.username, 'boss');
  assert.ok(!JSON.stringify(stored).includes('Correct-horse-42'), 'password is not stored');

  const s = adminAuth.login('BOSS', 'Correct-horse-42', '1.1.1.1');
  assert.equal(adminAuth.verifyToken(s.token).username, 'boss');

  const [body, sig] = s.token.split('.');
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url')), sub: 'someone' })).toString('base64url');
  assert.throws(() => adminAuth.verifyToken(`${forged}.${sig}`), adminAuth.AuthError, 'tampered token');
  assert.throws(() => adminAuth.verifyToken('garbage'), adminAuth.AuthError);

  adminAuth.setAdminPassword('boss', 'New-password-43');
  assert.throws(() => adminAuth.verifyToken(s.token), adminAuth.AuthError, 'old session revoked');
  assert.throws(() => adminAuth.login('boss', 'Correct-horse-42', '1.1.1.1'), adminAuth.AuthError);
  assert.ok(adminAuth.login('boss', 'New-password-43', '1.1.1.1').token);
});

test('5 wrong passwords lock that username for that IP', () => {
  adminAuth.resetForTests();
  for (let i = 0; i < 5; i++) assert.throws(() => adminAuth.login('boss', 'wrong-pass-1', '2.2.2.2'), (e) => e.statusCode === 401);
  assert.throws(() => adminAuth.login('boss', 'New-password-43', '2.2.2.2'), (e) => e.statusCode === 429, 'locked even with the right password');
  assert.ok(adminAuth.login('boss', 'New-password-43', '3.3.3.3').token, 'other IP unaffected');
});

// ═══ History ═════════════════════════════════════════════════════════════════

test('email history is stored newest first and filterable', () => {
  alertHistory.recordEmail({ fleetId: 100, status: 'sent', subject: 's1', to: ['a@x.com'] });
  alertHistory.recordEmail({ fleetId: 200, status: 'failed', subject: 's2', to: ['b@x.com'], error: 'boom' });
  const all = alertHistory.listEmails();
  assert.equal(all.entries[0].subject, 's2');
  assert.deepEqual(alertHistory.listEmails({ fleetId: 100 }).entries.map((e) => e.subject), ['s1']);
  assert.deepEqual(alertHistory.listEmails({ status: 'failed' }).entries.map((e) => e.error), ['boom']);
});

// ═══ HTTP API end to end ═════════════════════════════════════════════════════

test('admin API', quiet(async () => {
  adminAuth.resetForTests();
  const app = require('../src/app');
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (method, url, { token, body } = {}) => {
    const res = await fetch(base + url, {
      method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  };

  try {
    // Every admin route refuses requests without a valid session
    for (const [m, u] of [['GET', '/admin/overview'], ['GET', '/admin/fleets/100'], ['PUT', '/admin/fleets/100'],
      ['DELETE', '/admin/fleets/100'], ['POST', '/admin/fleets/100/test-email'], ['GET', '/admin/history'], ['GET', '/admin/audit']]) {
      assert.equal((await call(m, u)).status, 401, `${m} ${u} without token`);
      assert.equal((await call(m, u, { token: 'x.y' })).status, 401, `${m} ${u} with bad token`);
    }

    assert.equal((await call('POST', '/admin/login', { body: { username: 'boss', password: 'nope-nope-1' } })).status, 401);
    const { body: { data: { token } } } = await call('POST', '/admin/login', { body: { username: 'boss', password: 'New-password-43' } });

    // Overview never exposes the SMTP password
    const ov = await call('GET', '/admin/overview', { token });
    assert.equal(ov.status, 200);
    assert.ok(!JSON.stringify(ov.body).includes('"pass"'));
    assert.deepEqual(ov.body.data.fleets.map((f) => f.fleetId), [100, 200]);

    // Fleet detail with generators and effective limits
    const f100 = await call('GET', '/admin/fleets/100', { token });
    assert.deepEqual(f100.body.data.generators.map((g) => [g.vehicleId, g.limitC, g.customLimitC]), [[11, 55, 55], [12, 70, null]]);
    const live = await call('GET', '/admin/fleets/100/temperatures', { token });
    assert.deepEqual(live.body.data.generators.map((g) => g.temperatureC), [65.5, 65.5]);
    assert.equal((await call('GET', '/admin/fleets/555', { token })).status, 404);

    // Limits only for the fleet's own generators
    const foreign = await call('PUT', '/admin/fleets/200', { token, body: { revision: 1, settings: { enabled: true, recipients: { to: ['b@fleet200.com'] }, vehicleThresholdsC: { 11: 50 } } } });
    assert.equal(foreign.status, 400);
    assert.match(foreign.body.error.message, /Generator 11 does not belong to fleet 200/);

    // Address already receiving fleet 100's alerts → needs explicit confirmation
    const shared = await call('PUT', '/admin/fleets/200', { token, body: { revision: 1, settings: { enabled: true, recipients: { to: ['b@fleet200.com'], cc: ['a@fleet100.com'] } } } });
    assert.equal(shared.status, 409);
    assert.equal(shared.body.error.code, 'ADDRESS_IN_OTHER_FLEET');
    assert.deepEqual(shared.body.error.sharedAddresses, [{ address: 'a@fleet100.com', fleetIds: [100] }]);

    const ok = await call('PUT', '/admin/fleets/200', { token, body: { revision: 1, settings: { enabled: true, recipients: { to: ['b@fleet200.com'] } } } });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.data.settings.revision, 2);
    assert.ok(ok.body.data.changes.includes('emails switched on'));

    // Stale revision → conflict
    assert.equal((await call('PUT', '/admin/fleets/200', { token, body: { revision: 1, settings: { enabled: true, recipients: { to: ['c@fleet200.com'] } } } })).body.error.code, 'REVISION_CONFLICT');

    // Test email goes only to that fleet's saved recipients (To + BCC)
    sent.length = 0;
    const t = await call('POST', '/admin/fleets/100/test-email', { token });
    assert.equal(t.status, 200);
    assert.deepEqual(sent.map((m) => [m.to, m.cc, m.bcc]), [[['a@fleet100.com'], [], ['hidden@fleet100.com']]]);
    assert.match(sent[0].subject, /TEST, please ignore/);
    failNextSend = true;
    const bad = await call('POST', '/admin/fleets/200/test-email', { token });
    assert.equal(bad.status, 502);

    // History and audit
    const h = await call('GET', '/admin/history?fleetId=100', { token });
    assert.ok(h.body.data.entries.some((e) => e.test && e.status === 'sent' && e.sentBy === 'boss'));
    const hf = await call('GET', '/admin/history?status=failed&fleetId=200', { token });
    assert.ok(hf.body.data.entries.some((e) => e.error === '550 mailbox unavailable'));
    const a = await call('GET', '/admin/audit', { token });
    const actions = a.body.data.entries.map((e) => e.action);
    for (const act of ['login', 'login_failed', 'fleet_updated', 'test_email']) assert.ok(actions.includes(act), act);

    // Public status shows counts only
    const pub = await call('GET', '/alerts/status');
    assert.equal(pub.body.monitoredFleetCount, 2);
    assert.ok(!JSON.stringify(pub.body).match(/fleet100|vehicleThresholds|fleetIds/));

    // Remove a fleet
    assert.equal((await call('DELETE', '/admin/fleets/200?revision=2', { token })).status, 200);
    assert.equal(settings.getFleetSettings(200), null);
  } finally {
    server.close();
  }
}));

test('monitor emails each fleet only its own generators, with BCC', quiet(async () => {
  sent.length = 0;
  const cfg = getAlertConfig();
  settings.saveFleetSettings(200, { enabled: true, recipients: { to: ['b@fleet200.com'] }, defaultThresholdC: 60 }, { expectedRevision: 0, actor: 't' });
  // fleet 100: limits 55 (gen 11) / 70 (gen 12); fleet 200: 60. All read 65.5 °C.
  const mon = require('../src/services/temperatureMonitor');
  const summary = await mon.runOnce();
  assert.equal(summary.emailsSent, 2);
  const byTo = Object.fromEntries(sent.map((m) => [m.to.join(','), m]));
  assert.ok(byTo['a@fleet100.com'].text.includes('A-GEN-1'));
  assert.ok(!byTo['a@fleet100.com'].text.includes('A-GEN-2'), '65.5 °C is under gen 12\'s 70 °C limit');
  assert.ok(!byTo['a@fleet100.com'].text.includes('B-GEN'), 'no other fleet\'s generators');
  assert.deepEqual(byTo['a@fleet100.com'].bcc, ['hidden@fleet100.com']);
  assert.ok(byTo['b@fleet200.com'].text.includes('B-GEN-1'));
  assert.ok(!byTo['b@fleet200.com'].text.includes('A-GEN'));
  const hist = alertHistory.listEmails({ limit: 5 }).entries.filter((e) => !e.test && e.status === 'sent');
  assert.ok(hist.length >= 2);
}));
