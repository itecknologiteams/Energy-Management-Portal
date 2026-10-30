'use strict';

/**
 * Admin portal API for alert email settings. Every handler except login runs
 * behind requireAdmin. SMTP credentials are never returned.
 */

const adminAuth = require('../services/adminAuth');
const settings = require('../services/fleetAlertSettings');
const alertHistory = require('../services/alertHistory');
const temperatureMonitor = require('../services/temperatureMonitor');
const mailService = require('../services/mailService');
const { getAlertConfig, getConfigStatus } = require('../config/alertConfig');
const { getVehiclesByFleetId } = require('../repositories/fleetRepository');
const { getTrackingData } = require('../repositories/trackingRepository');
const { TrackingTableNotFoundError } = require('../utils/errors');
const { getLatestTemperatureReading } = require('../services/analyticsService');
const { dbClockNow, localDateString } = require('../services/alertService');

const LIVE_CONCURRENCY = 5;

function fail(res, status, code, message, extra = {}) {
  return res.status(status).json({ success: false, error: { code, message, ...extra } });
}

function parseFleetParam(req, res) {
  const id = settings.normalizeFleetId(req.params.fleetId);
  if (!id) {
    fail(res, 400, 'VALIDATION_ERROR', 'Fleet ID must be a positive whole number');
    return null;
  }
  return id;
}

/** Generators of a fleet from the CRM; [] when the fleet doesn't exist. */
async function fleetVehicles(fleetId) {
  try {
    return (await getVehiclesByFleetId(fleetId)).map((v) => ({
      vehicleId: parseInt(v.vehicleId, 10),
      vehicleName: v.vehicleName || `Generator ${v.vehicleId}`,
    }));
  } catch (err) {
    if (err.status === 404) return [];
    throw err;
  }
}

function allAddresses(r) {
  return [...r.to, ...r.cc, ...r.bcc];
}

function fleetWarnings(fleet, cfg) {
  const w = [];
  if (fleet.enabled && allAddresses(fleet.recipients).length === 0) w.push('No recipients: alerts for this fleet are not emailed');
  if (!fleet.enabled) w.push('Alert emails are paused for this fleet');
  if (fleet.enabled && !cfg.email.enabled) w.push('Email sending is switched off on the server (alerts.json)');
  if (fleet.enabled && !cfg.monitor.enabled) w.push('The background monitor is switched off on the server (alerts.json)');
  return w;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

async function login(req, res) {
  const { username, password } = req.body || {};
  if (!username || !password) return fail(res, 400, 'MISSING_CREDENTIALS', 'Username and password are required');
  try {
    const session = adminAuth.login(username, password, req.ip);
    alertHistory.recordAudit({ actor: session.username, action: 'login', ip: req.ip });
    return res.json({ success: true, data: session });
  } catch (err) {
    alertHistory.recordAudit({ actor: String(username).slice(0, 60), action: 'login_failed', ip: req.ip, details: { reason: err.code || 'error' } });
    return fail(res, err.statusCode || 401, err.code || 'UNAUTHORIZED', err.message);
  }
}

function session(req, res) {
  res.json({ success: true, data: req.admin });
}

// ─── Overview ─────────────────────────────────────────────────────────────────

function overview(req, res) {
  const cfg = getAlertConfig();
  const status = getConfigStatus();
  const managed = settings.listFleetSettings();
  const managedIds = new Set(managed.map((f) => f.fleetId));
  const lastRun = temperatureMonitor.getStatus().lastRun;

  res.json({
    success: true,
    data: {
      email: {
        enabled: cfg.email.enabled,
        from: cfg.email.from || null,
        smtpHost: cfg.email.smtp.host || null,
        smtpPort: cfg.email.smtp.port,
        secure: cfg.email.smtp.secure,
        subjectPrefix: cfg.email.subjectPrefix,
      },
      monitor: {
        enabled: cfg.monitor.enabled,
        intervalMinutes: cfg.monitor.intervalMinutes,
        maxReadingAgeMinutes: cfg.monitor.maxReadingAgeMinutes,
        repeatEmailEveryMinutes: cfg.monitor.repeatEmailEveryMinutes,
        sendRecoveryEmail: cfg.monitor.sendRecoveryEmail,
        monitoredFleetIds: settings.monitoredFleetIds(cfg),
        lastRun: lastRun ? {
          startedAt: lastRun.startedAt, finishedAt: lastRun.finishedAt, checked: lastRun.checked,
          alerts: lastRun.alerts, emailsSent: lastRun.emailsSent, errors: lastRun.errors.slice(0, 20),
        } : null,
      },
      temperature: {
        enabled: cfg.temperature.enabled,
        defaultThresholdC: cfg.temperature.defaultThresholdC,
        recoveryMarginC: cfg.temperature.recoveryMarginC,
      },
      config: { errors: status.errors, warnings: status.warnings },
      fleets: managed.map((f) => ({
        fleetId: f.fleetId,
        label: f.label,
        enabled: f.enabled,
        recipientCount: allAddresses(f.recipients).length,
        defaultThresholdC: f.defaultThresholdC,
        generatorLimitCount: Object.keys(f.vehicleThresholdsC).length,
        revision: f.revision,
        updatedAt: f.updatedAt,
        updatedBy: f.updatedBy,
        warnings: fleetWarnings(f, cfg),
      })),
      // Fleets still configured only in alerts.json (older setup)
      fleetsOnlyInAlertsJson: cfg.monitor.fleetIds.filter((id) => !managedIds.has(id)),
    },
  });
}

// ─── Fleet settings ───────────────────────────────────────────────────────────

async function getFleet(req, res, next) {
  const fleetId = parseFleetParam(req, res);
  if (!fleetId) return;
  try {
    const cfg = getAlertConfig();
    const vehicles = await fleetVehicles(fleetId);
    const fleet = settings.getFleetSettings(fleetId);
    if (vehicles.length === 0 && !fleet) return fail(res, 404, 'NOT_FOUND', `Fleet ${fleetId} was not found or has no generators`);

    const fleetDefault = fleet && fleet.defaultThresholdC !== null ? fleet.defaultThresholdC : cfg.temperature.defaultThresholdC;
    res.json({
      success: true,
      data: {
        fleetId,
        settings: fleet, // null → not configured yet
        serverDefaultThresholdC: cfg.temperature.defaultThresholdC,
        generators: vehicles.map((v) => ({
          ...v,
          limitC: fleet && fleet.vehicleThresholdsC[String(v.vehicleId)] !== undefined
            ? fleet.vehicleThresholdsC[String(v.vehicleId)] : fleetDefault,
          customLimitC: fleet ? (fleet.vehicleThresholdsC[String(v.vehicleId)] ?? null) : null,
        })),
        warnings: fleet ? fleetWarnings(fleet, cfg) : [],
        sharedAddresses: fleet ? settings.findAddressConflicts(fleetId, allAddresses(fleet.recipients)) : [],
      },
    });
  } catch (err) {
    next(err);
  }
}

/** Latest temperature per generator today (for the limits table). */
async function liveTemperatures(req, res, next) {
  const fleetId = parseFleetParam(req, res);
  if (!fleetId) return;
  try {
    const cfg = getAlertConfig();
    const vehicles = await fleetVehicles(fleetId);
    const date = localDateString(cfg);
    const nowMs = dbClockNow(cfg).getTime();
    const out = new Array(vehicles.length);
    let next_ = 0;
    await Promise.all(Array.from({ length: Math.min(LIVE_CONCURRENCY, vehicles.length) }, async () => {
      while (next_ < vehicles.length) {
        const idx = next_++;
        const v = vehicles[idx];
        let reading = null;
        try {
          reading = getLatestTemperatureReading(await getTrackingData(v.vehicleId, date));
        } catch (err) {
          if (!(err instanceof TrackingTableNotFoundError)) reading = { error: err.message };
        }
        out[idx] = {
          vehicleId: v.vehicleId,
          temperatureC: reading && !reading.error ? reading.celsius : null,
          readingAt: reading && !reading.error ? reading.at : null,
          ageMinutes: reading && reading.at ? Math.max(0, Math.round((nowMs - new Date(reading.at).getTime()) / 60000)) : null,
          error: reading && reading.error ? 'Could not read tracking data' : null,
        };
      }
    }));
    res.json({ success: true, data: { fleetId, date, generators: out } });
  } catch (err) {
    next(err);
  }
}

function describeChanges(before, after) {
  const changes = [];
  const b = before || { enabled: null, label: '', recipients: { to: [], cc: [], bcc: [] }, defaultThresholdC: null, vehicleThresholdsC: {} };
  if (b.enabled !== after.enabled) changes.push(after.enabled ? 'emails switched on' : 'emails paused');
  if ((b.label || '') !== after.label) changes.push(`label "${after.label}"`);
  for (const list of ['to', 'cc', 'bcc']) {
    const added = after.recipients[list].filter((a) => !b.recipients[list].includes(a));
    const removed = b.recipients[list].filter((a) => !after.recipients[list].includes(a));
    if (added.length) changes.push(`${list.toUpperCase()} added ${added.join(', ')}`);
    if (removed.length) changes.push(`${list.toUpperCase()} removed ${removed.join(', ')}`);
  }
  if (b.defaultThresholdC !== after.defaultThresholdC) changes.push(`fleet limit ${b.defaultThresholdC ?? 'server default'} → ${after.defaultThresholdC ?? 'server default'}`);
  const ids = new Set([...Object.keys(b.vehicleThresholdsC), ...Object.keys(after.vehicleThresholdsC)]);
  for (const id of ids) {
    if (b.vehicleThresholdsC[id] !== after.vehicleThresholdsC[id]) {
      changes.push(`generator ${id} limit ${b.vehicleThresholdsC[id] ?? 'fleet limit'} → ${after.vehicleThresholdsC[id] ?? 'fleet limit'}`);
    }
  }
  return changes;
}

async function saveFleet(req, res, next) {
  const fleetId = parseFleetParam(req, res);
  if (!fleetId) return;
  const body = req.body || {};
  try {
    // 1. Shape and value checks
    const { value, errors } = settings.validateFleetSettings(body.settings);
    if (errors.length > 0) return fail(res, 400, 'VALIDATION_ERROR', errors[0], { errors });

    // 2. The fleet must exist, and limits may only be set for its own generators
    const vehicles = await fleetVehicles(fleetId);
    if (vehicles.length === 0) return fail(res, 404, 'NOT_FOUND', `Fleet ${fleetId} was not found or has no generators`);
    const own = new Set(vehicles.map((v) => String(v.vehicleId)));
    const foreign = Object.keys(value.vehicleThresholdsC).filter((id) => !own.has(id));
    if (foreign.length > 0) {
      return fail(res, 400, 'VALIDATION_ERROR', `Generator ${foreign.join(', ')} does not belong to fleet ${fleetId}`, { errors: [`Generator ${foreign.join(', ')} does not belong to fleet ${fleetId}`] });
    }

    // 3. Confidentiality guard: an address already receiving another fleet's alerts
    const shared = settings.findAddressConflicts(fleetId, allAddresses(value.recipients));
    if (shared.length > 0 && body.confirmSharedAddresses !== true) {
      return fail(res, 409, 'ADDRESS_IN_OTHER_FLEET',
        'Some addresses already receive alerts for another fleet. Confirm only if this person is allowed to see both fleets.',
        { sharedAddresses: shared });
    }

    // 4. Save with optimistic locking
    const before = settings.getFleetSettings(fleetId);
    const saved = settings.saveFleetSettings(fleetId, value, { expectedRevision: body.revision ?? 0, actor: req.admin.username });
    const changes = describeChanges(before, saved);
    alertHistory.recordAudit({
      actor: req.admin.username, action: before ? 'fleet_updated' : 'fleet_added', ip: req.ip, fleetId,
      details: { changes, sharedAddressesConfirmed: shared.map((s) => s.address) },
    });
    res.json({ success: true, data: { settings: saved, changes, warnings: fleetWarnings(saved, getAlertConfig()) } });
  } catch (err) {
    if (err instanceof settings.RevisionConflictError) {
      return fail(res, 409, 'REVISION_CONFLICT', err.message, { current: err.current });
    }
    if (err instanceof settings.SettingsValidationError) {
      return fail(res, 400, 'VALIDATION_ERROR', err.errors[0], { errors: err.errors });
    }
    next(err);
  }
}

function deleteFleet(req, res, next) {
  const fleetId = parseFleetParam(req, res);
  if (!fleetId) return;
  try {
    const revision = req.query.revision !== undefined ? parseInt(req.query.revision, 10) : null;
    if (!settings.deleteFleetSettings(fleetId, { expectedRevision: revision })) {
      return fail(res, 404, 'NOT_FOUND', `Fleet ${fleetId} has no alert settings`);
    }
    alertHistory.recordAudit({ actor: req.admin.username, action: 'fleet_removed', ip: req.ip, fleetId });
    res.json({ success: true });
  } catch (err) {
    if (err instanceof settings.RevisionConflictError) return fail(res, 409, 'REVISION_CONFLICT', err.message, { current: err.current });
    next(err);
  }
}

async function sendTestEmail(req, res, next) {
  const fleetId = parseFleetParam(req, res);
  if (!fleetId) return;
  try {
    const cfg = getAlertConfig();
    if (!cfg.email.enabled) return fail(res, 400, 'EMAIL_DISABLED', 'Email sending is switched off on the server (alerts.json → email.enabled)');
    const fleet = settings.getFleetSettings(fleetId);
    if (!fleet) return fail(res, 404, 'NOT_FOUND', 'Save this fleet\'s settings first');
    const r = fleet.recipients;
    if (allAddresses(r).length === 0) return fail(res, 400, 'NO_RECIPIENTS', 'This fleet has no recipients');

    const threshold = fleet.defaultThresholdC ?? cfg.temperature.defaultThresholdC;
    const items = [{ kind: 'alert', vehicleId: 0, vehicleName: 'TEST GENERATOR (sample)', celsius: threshold + 5, threshold, at: new Date().toISOString(), since: null }];
    const email = temperatureMonitor.buildTemperatureEmail(fleetId, items, { ...cfg, dbTimestampsAreLocalTime: false });
    const subject = `${email.subject} — TEST, please ignore`;
    const record = { fleetId, subject, to: r.to, cc: r.cc, bcc: r.bcc, items, test: true, sentBy: req.admin.username };

    try {
      const info = await mailService.sendMail({ ...email, subject, to: r.to, cc: r.cc, bcc: r.bcc }, cfg);
      const entry = alertHistory.recordEmail({ ...record, status: 'sent', messageId: info.messageId });
      alertHistory.recordAudit({ actor: req.admin.username, action: 'test_email', ip: req.ip, fleetId, details: { status: 'sent' } });
      res.json({ success: true, data: { entry, rejected: info.rejected } });
    } catch (err) {
      const entry = alertHistory.recordEmail({ ...record, status: 'failed', error: err.message });
      alertHistory.recordAudit({ actor: req.admin.username, action: 'test_email', ip: req.ip, fleetId, details: { status: 'failed' } });
      fail(res, 502, 'SEND_FAILED', `The mail server did not accept the email: ${err.message}`, { entry });
    }
  } catch (err) {
    next(err);
  }
}

// ─── History ──────────────────────────────────────────────────────────────────

function history(req, res) {
  const fleetId = req.query.fleetId ? settings.normalizeFleetId(req.query.fleetId) : null;
  const status = ['sent', 'failed'].includes(req.query.status) ? req.query.status : null;
  const page = alertHistory.listEmails({ fleetId, status, limit: req.query.limit, before: req.query.before || null });
  res.json({ success: true, data: page });
}

function audit(req, res) {
  res.json({ success: true, data: { entries: alertHistory.listAudit({ limit: req.query.limit }) } });
}

module.exports = {
  login, session, overview, getFleet, liveTemperatures, saveFleet, deleteFleet, sendTestEmail, history, audit,
  describeChanges, // exported for tests
};
