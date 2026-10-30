'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { validate, merge, DEFAULTS, getTemperatureThreshold, getRecipientsForFleet } = require('../src/config/alertConfig');
const { evaluateTemperature, timezoneOffsetMinutes, dbClockNow, localDateString } = require('../src/services/alertService');
const { getLatestTemperatureReading } = require('../src/services/analyticsService');
const { decide, rulesFromConfig, buildTemperatureEmail } = require('../src/services/temperatureMonitor');

const example = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'alerts.example.json'), 'utf8'));
const config = (overrides = {}) => validate(merge(merge(DEFAULTS, example), overrides));

test('example config loads without errors', () => {
  const { errors } = config();
  assert.deepEqual(errors, []);
});

test('per-vehicle threshold overrides the default', () => {
  const { config: cfg } = config({ temperature: { defaultThresholdC: 90, vehicleThresholdsC: { 100: 60 } } });
  assert.equal(getTemperatureThreshold(100, cfg), 60);
  assert.equal(getTemperatureThreshold('100', cfg), 60);
  assert.equal(getTemperatureThreshold(200, cfg), 90);
});

test('invalid thresholds are rejected safely', () => {
  const { config: cfg, errors, warnings } = config({
    temperature: { defaultThresholdC: 'hot', vehicleThresholdsC: { 1: 999, abc: 50 } },
  });
  assert.equal(cfg.temperature.enabled, false);
  assert.ok(errors.length > 0);
  assert.equal(warnings.filter((w) => w.includes('vehicleThresholdsC')).length, 2);
});

test('email is disabled when SMTP settings are incomplete', () => {
  const { config: cfg, errors } = config({ email: { enabled: true, smtp: { host: '' } } });
  assert.equal(cfg.email.enabled, false);
  assert.ok(errors.some((e) => e.includes('smtp.host')));
});

test('each fleet is emailed only on its own list; others get nothing', () => {
  const { config: cfg } = config({
    email: { recipients: { default: { to: ['ops@example.com'] }, byFleet: { 5: { to: ['five@example.com'] }, 6: { to: [] } } } },
  });
  assert.deepEqual(getRecipientsForFleet(5, cfg).to, ['five@example.com']);
  assert.deepEqual(getRecipientsForFleet(6, cfg).to, [], 'empty list is not replaced by default');
  assert.deepEqual(getRecipientsForFleet(7, cfg).to, [], 'unlisted fleet is not sent to default');
});

test('default list is used for unlisted fleets only when explicitly enabled', () => {
  const { config: cfg } = config({
    email: { recipients: { default: { to: ['ops@example.com'] }, byFleet: { 5: { to: ['five@example.com'] } }, defaultForFleetsWithoutRecipients: true } },
  });
  assert.deepEqual(getRecipientsForFleet(5, cfg).to, ['five@example.com'], 'own list still wins');
  assert.deepEqual(getRecipientsForFleet(7, cfg).to, ['ops@example.com']);
});

test('a monitored fleet without recipients is reported', () => {
  const { warnings } = config({
    monitor: { enabled: true, fleetIds: [5, 9] },
    email: { enabled: true, recipients: { byFleet: { 5: { to: ['five@example.com'] } } }, smtp: { host: 'smtp.example.com' } },
  });
  assert.ok(warnings.some((w) => w.includes('fleet 9') && w.includes('not be emailed')));
  assert.ok(!warnings.some((w) => w.includes('fleet 5 ')));
});

test('alert only when temperature is above the threshold', () => {
  const { config: cfg } = config({ temperature: { defaultThresholdC: 70, vehicleThresholdsC: {} } });
  assert.deepEqual(evaluateTemperature(1, 70, cfg), { temperatureThreshold: 70, temperatureAlert: false });
  assert.deepEqual(evaluateTemperature(1, 70.1, cfg), { temperatureThreshold: 70, temperatureAlert: true });
  assert.deepEqual(evaluateTemperature(1, null, cfg), { temperatureThreshold: 70, temperatureAlert: false });
  cfg.temperature.enabled = false;
  assert.deepEqual(evaluateTemperature(1, 99, cfg), { temperatureThreshold: null, temperatureAlert: false });
});

test('latest temperature reading includes its time', () => {
  const rows = [
    { timestamp: '2026-10-01T10:00:00Z', params: '{"72":"655"}' },
    { timestamp: '2026-10-01T10:05:00Z', params: '{"72":"0"}' },   // power-loss zero, skipped
    { timestamp: '2026-10-01T10:06:00Z', params: '{"1":"1"}' },
  ];
  assert.deepEqual(getLatestTemperatureReading(rows), { celsius: 65.5, at: '2026-10-01T10:00:00.000Z' });
  assert.equal(getLatestTemperatureReading([]), null);
});

test('timezone helpers', () => {
  const now = new Date('2026-10-27T20:30:00Z');
  const { config: cfg } = config();
  assert.equal(timezoneOffsetMinutes('Asia/Karachi', now), 300);
  assert.equal(dbClockNow(cfg, now).toISOString(), '2026-10-28T01:30:00.000Z');
  assert.equal(localDateString(cfg, now), '2026-10-28');
  assert.equal(dbClockNow({ ...cfg, dbTimestampsAreLocalTime: false }, now).toISOString(), now.toISOString());
});

test('monitor state: alert, hold, repeat, recover', () => {
  const rules = { recoveryMarginC: 2, repeatEmailEveryMinutes: 60, sendRecoveryEmail: true };
  const r = (celsius, at = '2026-10-01T10:00:00Z') => ({ celsius, at });
  const t0 = Date.UTC(2026, 9, 1, 10);

  let step = decide(undefined, r(85), 90, rules, t0);
  assert.equal(step.notify, null);
  assert.equal(step.state.active, false);

  step = decide(step.state, r(95), 90, rules, t0);
  assert.equal(step.notify, 'alert');
  assert.equal(step.state.active, true);
  step.state.lastEmailAt = t0; // email delivered

  step = decide(step.state, r(96), 90, rules, t0 + 30 * 60000);
  assert.equal(step.notify, null, 'no repeat before the repeat interval');

  step = decide(step.state, null, 90, rules, t0 + 40 * 60000);
  assert.equal(step.notify, null, 'missing reading keeps state');
  assert.equal(step.state.active, true);

  step = decide(step.state, r(89), 90, rules, t0 + 45 * 60000);
  assert.equal(step.notify, null, 'within recovery margin stays active');
  assert.equal(step.state.active, true);

  step = decide(step.state, r(97), 90, rules, t0 + 61 * 60000);
  assert.equal(step.notify, 'repeat');
  step.state.lastEmailAt = t0 + 61 * 60000;

  step = decide(step.state, r(87), 90, rules, t0 + 70 * 60000);
  assert.equal(step.notify, 'recovered');
  assert.equal(step.state.active, false);
});

test('monitor rules are read from the right config sections', () => {
  const { config: cfg } = config({ temperature: { recoveryMarginC: 3 }, monitor: { repeatEmailEveryMinutes: 15, sendRecoveryEmail: false } });
  assert.deepEqual(rulesFromConfig(cfg), { recoveryMarginC: 3, repeatEmailEveryMinutes: 15, sendRecoveryEmail: false });
});

test('a failed email is retried on the next cycle', () => {
  const rules = { recoveryMarginC: 2, repeatEmailEveryMinutes: 60, sendRecoveryEmail: true };
  let step = decide(undefined, { celsius: 95, at: 'x' }, 90, rules, 0);
  assert.equal(step.notify, 'alert');
  step = decide(step.state, { celsius: 95, at: 'x' }, 90, rules, 60000); // lastEmailAt never set
  assert.equal(step.notify, 'alert');
});

test('no recovery email when the alert was never emailed', () => {
  const rules = { recoveryMarginC: 2, repeatEmailEveryMinutes: 60, sendRecoveryEmail: true };
  const step = decide({ active: true, lastEmailAt: null }, { celsius: 50, at: 'x' }, 90, rules, 0);
  assert.equal(step.notify, null);
  assert.equal(step.state.active, false);
});

test('email content escapes names and lists every item', () => {
  const { config: cfg } = config();
  const email = buildTemperatureEmail(1735, [
    { kind: 'alert', vehicleId: 1, vehicleName: 'GEN <A>', celsius: 95, threshold: 90, at: '2026-10-01T10:00:00Z', since: '2026-10-01T10:00:00Z' },
    { kind: 'recovered', vehicleId: 2, vehicleName: 'GEN B', celsius: 80, threshold: 90, at: '2026-10-01T10:00:00Z', since: null },
  ], cfg);
  assert.match(email.subject, /High temperature: GEN <A> 95 °C \(limit 90 °C\)/);
  assert.ok(email.html.includes('GEN &lt;A&gt;'));
  assert.ok(!email.html.includes('GEN <A>'));
  assert.ok(email.text.includes('Back to normal: GEN B'));
  assert.ok(email.text.includes('01 Oct 2026, 10:00 am'), 'local DB time printed as stored');
});

test('config file is re-read when it changes and survives broken JSON', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alerts-'));
  const file = path.join(dir, 'alerts.json');
  process.env.ALERTS_CONFIG_PATH = file;
  const loader = require('../src/config/alertConfig');
  loader.resetCache();

  const silence = ['log', 'warn', 'error'].map((k) => [k, console[k]]);
  silence.forEach(([k]) => { console[k] = () => {}; });
  try {
    assert.equal(loader.getAlertConfig().monitor.enabled, false, 'missing file → defaults');

    fs.writeFileSync(file, JSON.stringify({ temperature: { defaultThresholdC: 65 } }));
    assert.equal(loader.getAlertConfig().temperature.defaultThresholdC, 65);

    await new Promise((r) => setTimeout(r, 20));
    fs.writeFileSync(file, '{ not json');
    fs.utimesSync(file, new Date(), new Date(Date.now() + 5000));
    assert.equal(loader.getAlertConfig().temperature.defaultThresholdC, 65, 'keeps last good config');
    assert.ok(loader.getConfigStatus().errors[0].includes('Could not read'));
  } finally {
    silence.forEach(([k, fn]) => { console[k] = fn; });
    delete process.env.ALERTS_CONFIG_PATH;
    loader.resetCache();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
