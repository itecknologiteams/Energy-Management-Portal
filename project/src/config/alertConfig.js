'use strict';

/**
 * Alert configuration loader.
 *
 * Reads project/config/alerts.json (or the file named by ALERTS_CONFIG_PATH),
 * merges it over safe defaults, validates it, and caches it by file mtime so
 * edits are picked up on the next read without a restart.
 *
 * A broken file never takes the API down: the last valid configuration is
 * kept (or the defaults, which have email disabled) and the problem is logged.
 *
 * SMTP secrets can come from the environment instead of the JSON file:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD
 */

const fs = require('fs');
const path = require('path');
const { TEMPERATURE_MIN_C, TEMPERATURE_MAX_C } = require('../constants');

const DEFAULT_CONFIG_PATH = path.join(__dirname, '..', '..', 'config', 'alerts.json');

const DEFAULTS = Object.freeze({
  timezone: 'Asia/Karachi',
  dbTimestampsAreLocalTime: true,
  temperature: {
    enabled: true,
    defaultThresholdC: 90,
    vehicleThresholdsC: {},
    recoveryMarginC: 2,
  },
  monitor: {
    enabled: false,
    intervalMinutes: 5,
    fleetIds: [],
    maxReadingAgeMinutes: 30,
    repeatEmailEveryMinutes: 60,
    sendRecoveryEmail: true,
  },
  email: {
    enabled: false,
    from: '',
    subjectPrefix: '[EMS Alert]',
    recipients: { default: { to: [], cc: [] }, byFleet: {} },
    smtp: {
      host: '',
      port: 587,
      secure: false,
      auth: { user: '', pass: '' },
      tls: { rejectUnauthorized: true },
      connectionTimeoutMs: 15000,
    },
  },
});

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

let cache = { mtimeMs: null, path: null, config: null, errors: [], warnings: [] };

function configPath() {
  return process.env.ALERTS_CONFIG_PATH || DEFAULT_CONFIG_PATH;
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Deep-merge `override` onto `base`; arrays and scalars replace. */
function merge(base, override) {
  if (!isPlainObject(override)) return clone(base);
  const out = clone(base);
  for (const [key, value] of Object.entries(override)) {
    if (key.startsWith('_')) continue; // comment keys such as "_readme"
    out[key] = isPlainObject(value) && isPlainObject(base[key]) ? merge(base[key], value) : value;
  }
  return out;
}

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

function isValidTimezone(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function isTemperature(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= TEMPERATURE_MIN_C && v <= TEMPERATURE_MAX_C;
}

function cleanAddressList(list, label, warnings) {
  if (list === undefined || list === null) return [];
  const items = Array.isArray(list) ? list : [list];
  return items.filter((addr) => {
    const bare = String(addr).match(/<([^>]+)>/)?.[1] ?? String(addr);
    if (EMAIL_RE.test(bare.trim())) return true;
    warnings.push(`${label}: ignoring invalid email address "${addr}"`);
    return false;
  });
}

/**
 * Validate and normalise a merged config. Problems that make a section unsafe
 * disable that section (errors); minor problems are corrected (warnings).
 *
 * @param {Object} cfg - merged config (mutated in place)
 * @returns {{ config:Object, errors:string[], warnings:string[] }}
 */
function validate(cfg) {
  const errors = [];
  const warnings = [];

  if (!isValidTimezone(cfg.timezone)) {
    warnings.push(`timezone "${cfg.timezone}" is not valid; using ${DEFAULTS.timezone}`);
    cfg.timezone = DEFAULTS.timezone;
  }
  cfg.dbTimestampsAreLocalTime = cfg.dbTimestampsAreLocalTime !== false;

  // ── temperature ─────────────────────────────────────────────────────────────
  const t = cfg.temperature;
  t.enabled = t.enabled !== false;
  if (!isTemperature(t.defaultThresholdC)) {
    errors.push(`temperature.defaultThresholdC must be a number between ${TEMPERATURE_MIN_C} and ${TEMPERATURE_MAX_C}; temperature alerts disabled`);
    t.enabled = false;
  }
  const overrides = {};
  for (const [id, value] of Object.entries(isPlainObject(t.vehicleThresholdsC) ? t.vehicleThresholdsC : {})) {
    if (!/^\d+$/.test(id)) {
      warnings.push(`temperature.vehicleThresholdsC: "${id}" is not a vehicle ID; ignored`);
    } else if (!isTemperature(value)) {
      warnings.push(`temperature.vehicleThresholdsC["${id}"] = ${JSON.stringify(value)} is not a valid temperature; ignored`);
    } else {
      overrides[id] = value;
    }
  }
  t.vehicleThresholdsC = overrides;
  if (typeof t.recoveryMarginC !== 'number' || t.recoveryMarginC < 0 || t.recoveryMarginC > 20) {
    warnings.push('temperature.recoveryMarginC must be 0-20; using 2');
    t.recoveryMarginC = 2;
  }

  // ── monitor ─────────────────────────────────────────────────────────────────
  const m = cfg.monitor;
  m.enabled = m.enabled === true;
  const positive = (key, min, fallback) => {
    if (typeof m[key] !== 'number' || !Number.isFinite(m[key]) || m[key] < min) {
      warnings.push(`monitor.${key} must be a number >= ${min}; using ${fallback}`);
      m[key] = fallback;
    }
  };
  positive('intervalMinutes', 1, 5);
  positive('maxReadingAgeMinutes', 1, 30);
  positive('repeatEmailEveryMinutes', 0, 60);
  m.sendRecoveryEmail = m.sendRecoveryEmail !== false;
  m.fleetIds = (Array.isArray(m.fleetIds) ? m.fleetIds : [])
    .map((id) => parseInt(id, 10))
    .filter((id) => Number.isInteger(id) && id > 0);
  if (m.enabled && m.fleetIds.length === 0) {
    errors.push('monitor.fleetIds is empty; background monitor disabled');
    m.enabled = false;
  }

  // ── email ───────────────────────────────────────────────────────────────────
  const e = cfg.email;
  e.enabled = e.enabled === true;
  const r = isPlainObject(e.recipients) ? e.recipients : {};
  const def = isPlainObject(r.default) ? r.default : {};
  e.recipients = {
    default: {
      to: cleanAddressList(def.to, 'email.recipients.default.to', warnings),
      cc: cleanAddressList(def.cc, 'email.recipients.default.cc', warnings),
    },
    byFleet: {},
  };
  for (const [fleetId, entry] of Object.entries(isPlainObject(r.byFleet) ? r.byFleet : {})) {
    if (!isPlainObject(entry)) continue;
    e.recipients.byFleet[String(fleetId)] = {
      to: cleanAddressList(entry.to, `email.recipients.byFleet["${fleetId}"].to`, warnings),
      cc: cleanAddressList(entry.cc, `email.recipients.byFleet["${fleetId}"].cc`, warnings),
    };
  }

  // Environment overrides keep secrets out of the JSON file if preferred
  const s = e.smtp;
  if (process.env.SMTP_HOST) s.host = process.env.SMTP_HOST;
  if (process.env.SMTP_PORT) s.port = parseInt(process.env.SMTP_PORT, 10);
  if (process.env.SMTP_USER) s.auth.user = process.env.SMTP_USER;
  if (process.env.SMTP_PASSWORD) s.auth.pass = process.env.SMTP_PASSWORD;
  s.port = parseInt(s.port, 10);
  s.secure = s.secure === true;

  if (e.enabled) {
    const problems = [];
    if (!s.host) problems.push('email.smtp.host is empty');
    if (!Number.isInteger(s.port) || s.port < 1 || s.port > 65535) problems.push('email.smtp.port is invalid');
    if (!e.from) problems.push('email.from is empty');
    const anyRecipient = e.recipients.default.to.length > 0 ||
      Object.values(e.recipients.byFleet).some((f) => f.to.length > 0);
    if (!anyRecipient) problems.push('no recipients configured');
    if (problems.length > 0) {
      errors.push(`${problems.join('; ')}; email disabled`);
      e.enabled = false;
    }
  }

  return { config: cfg, errors, warnings };
}

/**
 * Current alert configuration (re-read when the file changes).
 * @returns {Object}
 */
function getAlertConfig() {
  const file = configPath();
  let stat = null;
  try {
    stat = fs.statSync(file);
  } catch {
    // No file: run on defaults (email + monitor disabled), warn once
    if (cache.path !== file || cache.mtimeMs !== -1) {
      const result = validate(merge(DEFAULTS, {}));
      cache = { path: file, mtimeMs: -1, config: result.config, errors: [], warnings: [`${file} not found; using defaults (email and monitor disabled)`] };
      console.warn(`[alertConfig] ${cache.warnings[0]}`);
    }
    return cache.config;
  }

  if (cache.path === file && cache.mtimeMs === stat.mtimeMs && cache.config) return cache.config;

  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const result = validate(merge(DEFAULTS, raw));
    cache = { path: file, mtimeMs: stat.mtimeMs, ...result };
    result.warnings.forEach((w) => console.warn(`[alertConfig] ${w}`));
    result.errors.forEach((err) => console.error(`[alertConfig] ${err}`));
    console.log(`[alertConfig] Loaded ${file}`);
  } catch (err) {
    console.error(`[alertConfig] Could not read ${file}: ${err.message}. Keeping previous configuration.`);
    cache.mtimeMs = stat.mtimeMs; // don't re-log the same broken file every call
    cache.path = file;
    cache.errors = [`Could not read ${file}: ${err.message}`];
    if (!cache.config) cache.config = validate(merge(DEFAULTS, {})).config;
  }
  return cache.config;
}

/** Errors and warnings from the most recent load. */
function getConfigStatus() {
  getAlertConfig();
  return { path: cache.path, errors: [...cache.errors], warnings: [...cache.warnings] };
}

/**
 * Threshold (°C) for a vehicle: its override, else the global default.
 * @param {number|string} vehicleId
 * @param {Object} [cfg]
 */
function getTemperatureThreshold(vehicleId, cfg = getAlertConfig()) {
  const override = cfg.temperature.vehicleThresholdsC[String(vehicleId)];
  return override !== undefined ? override : cfg.temperature.defaultThresholdC;
}

/**
 * Recipients for a fleet: its own list when it has "to" addresses, else default.
 * @param {number|string} fleetId
 * @param {Object} [cfg]
 * @returns {{to:string[], cc:string[]}}
 */
function getRecipientsForFleet(fleetId, cfg = getAlertConfig()) {
  const fleet = cfg.email.recipients.byFleet[String(fleetId)];
  return fleet && fleet.to.length > 0 ? fleet : cfg.email.recipients.default;
}

/** Test helper — forget the cached file. */
function resetCache() {
  cache = { mtimeMs: null, path: null, config: null, errors: [], warnings: [] };
}

module.exports = {
  getAlertConfig,
  getConfigStatus,
  getTemperatureThreshold,
  getRecipientsForFleet,
  validate,
  merge,
  DEFAULTS,
  resetCache,
};
