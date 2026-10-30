'use strict';

/**
 * Per-fleet alert settings managed from the admin portal.
 *
 * Stored in data/fleet-alerts.json (path overridable with FLEET_ALERTS_PATH):
 *
 *   {
 *     "version": 1,
 *     "fleets": {
 *       "2086": {
 *         "label": "TCM",
 *         "enabled": true,
 *         "recipients": { "to": [...], "cc": [...], "bcc": [...] },
 *         "defaultThresholdC": 60,          // null → global default from alerts.json
 *         "vehicleThresholdsC": { "413532": 55 },
 *         "revision": 4, "updatedAt": "...", "updatedBy": "admin"
 *       }
 *     }
 *   }
 *
 * Confidentiality rules enforced here:
 *   - a fleet's alerts go only to that fleet's own recipients;
 *   - a paused fleet (enabled = false) is not emailed at all;
 *   - the global default list is used only for fleets that have no settings
 *     here AND only when alerts.json explicitly allows it.
 *
 * Resolution order for a generator's temperature limit:
 *   fleet vehicle limit → fleet default → alerts.json vehicle limit → alerts.json default
 */

const fs = require('fs');
const path = require('path');
const { readJson, writeJson } = require('../utils/jsonStore');
const { getAlertConfig } = require('../config/alertConfig');
const { TEMPERATURE_MIN_C, TEMPERATURE_MAX_C } = require('../constants');

const STORE_VERSION = 1;
const MAX_ADDRESSES_PER_LIST = 50;
const MAX_LABEL_LENGTH = 80;
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[A-Za-z]{2,}$/;

class SettingsValidationError extends Error {
  constructor(errors) {
    super(errors.join('; '));
    this.name = 'SettingsValidationError';
    this.errors = errors;
    this.statusCode = 400;
  }
}

class RevisionConflictError extends Error {
  constructor(current) {
    super('These settings were changed by someone else. Reload and try again.');
    this.name = 'RevisionConflictError';
    this.current = current;
    this.statusCode = 409;
  }
}

function storePath() {
  return process.env.FLEET_ALERTS_PATH || path.join(__dirname, '..', '..', 'data', 'fleet-alerts.json');
}

let cache = { path: null, mtimeMs: null, store: null };

function emptyStore() {
  return { version: STORE_VERSION, fleets: {} };
}

function normalizeFleetId(fleetId) {
  const n = parseInt(fleetId, 10);
  return Number.isInteger(n) && n > 0 && String(n) === String(fleetId).trim() ? n : null;
}

/**
 * First run: build the store from the per-fleet parts of alerts.json so
 * existing setups keep working when the portal is introduced.
 */
function seedFromConfig(cfg) {
  const store = emptyStore();
  const ids = new Set([
    ...cfg.monitor.fleetIds.map(String),
    ...Object.keys(cfg.email.recipients.byFleet),
  ]);
  const now = new Date().toISOString();
  for (const id of ids) {
    const r = cfg.email.recipients.byFleet[id] || { to: [], cc: [] };
    store.fleets[id] = {
      label: '',
      enabled: cfg.monitor.fleetIds.map(String).includes(id),
      recipients: { to: [...r.to], cc: [...r.cc], bcc: [] },
      defaultThresholdC: null,
      vehicleThresholdsC: {},
      revision: 1,
      updatedAt: now,
      updatedBy: 'imported from alerts.json',
    };
  }
  return store;
}

/** Current store (re-read when the file changes on disk). */
function loadStore() {
  const file = storePath();
  let stat = null;
  try { stat = fs.statSync(file); } catch { /* missing */ }

  if (!stat) {
    if (cache.path === file && cache.mtimeMs === -1 && cache.store) return cache.store;
    const seeded = seedFromConfig(getAlertConfig());
    if (Object.keys(seeded.fleets).length > 0) {
      try {
        writeJson(file, seeded, { keepBackups: 0 });
        console.log(`[fleetAlertSettings] Created ${file} from alerts.json (${Object.keys(seeded.fleets).length} fleet(s))`);
        stat = fs.statSync(file);
      } catch (err) {
        console.error(`[fleetAlertSettings] Could not create ${file}: ${err.message}`);
      }
    }
    cache = { path: file, mtimeMs: stat ? stat.mtimeMs : -1, store: seeded };
    return seeded;
  }

  if (cache.path === file && cache.mtimeMs === stat.mtimeMs && cache.store) return cache.store;

  try {
    const raw = readJson(file, emptyStore());
    const store = { version: STORE_VERSION, fleets: {} };
    for (const [id, fleet] of Object.entries(raw.fleets || {})) {
      if (!normalizeFleetId(id)) continue;
      const { value } = validateFleetSettings(fleet, { lenient: true });
      store.fleets[id] = {
        ...value,
        revision: Number.isInteger(fleet.revision) ? fleet.revision : 1,
        updatedAt: fleet.updatedAt || null,
        updatedBy: fleet.updatedBy || null,
      };
    }
    cache = { path: file, mtimeMs: stat.mtimeMs, store };
  } catch (err) {
    console.error(`[fleetAlertSettings] ${err.message}. Keeping previous settings.`);
    if (!cache.store) cache = { path: file, mtimeMs: stat.mtimeMs, store: emptyStore() };
    else cache.mtimeMs = stat.mtimeMs;
  }
  return cache.store;
}

// ─── Validation ───────────────────────────────────────────────────────────────

function cleanAddresses(list, label, errors) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) {
    errors.push(`${label} must be a list of email addresses`);
    return [];
  }
  const out = [];
  for (const item of list) {
    const addr = String(item ?? '').trim().toLowerCase();
    if (!addr) continue;
    if (!EMAIL_RE.test(addr) || addr.length > 254) {
      errors.push(`${label}: "${item}" is not a valid email address`);
      continue;
    }
    if (!out.includes(addr)) out.push(addr);
  }
  if (out.length > MAX_ADDRESSES_PER_LIST) errors.push(`${label}: at most ${MAX_ADDRESSES_PER_LIST} addresses`);
  return out;
}

function isTemperature(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= TEMPERATURE_MIN_C && v <= TEMPERATURE_MAX_C;
}

/**
 * Validate and normalise fleet settings from the admin API.
 * Addresses are lower-cased and de-duplicated; an address appears in only one
 * of to/cc/bcc (first wins, in that order).
 *
 * @param {Object} input
 * @param {{lenient?:boolean}} [options] - lenient drops bad values instead of failing (used when reading the file)
 * @returns {{ value:Object, errors:string[] }}
 */
function validateFleetSettings(input, { lenient = false } = {}) {
  const errors = [];
  const src = input && typeof input === 'object' ? input : {};

  const label = typeof src.label === 'string' ? src.label.trim().slice(0, MAX_LABEL_LENGTH) : '';
  const enabled = src.enabled !== false;

  const r = src.recipients && typeof src.recipients === 'object' ? src.recipients : {};
  const to = cleanAddresses(r.to, 'To', errors);
  const cc = cleanAddresses(r.cc, 'CC', errors).filter((a) => !to.includes(a));
  const bcc = cleanAddresses(r.bcc, 'BCC', errors).filter((a) => !to.includes(a) && !cc.includes(a));

  let defaultThresholdC = null;
  if (src.defaultThresholdC !== null && src.defaultThresholdC !== undefined && src.defaultThresholdC !== '') {
    const n = Number(src.defaultThresholdC);
    if (isTemperature(n)) defaultThresholdC = Math.round(n * 10) / 10;
    else errors.push(`Fleet temperature limit must be between ${TEMPERATURE_MIN_C} and ${TEMPERATURE_MAX_C} °C`);
  }

  const vehicleThresholdsC = {};
  const vt = src.vehicleThresholdsC && typeof src.vehicleThresholdsC === 'object' ? src.vehicleThresholdsC : {};
  for (const [id, value] of Object.entries(vt)) {
    if (!/^\d+$/.test(id)) { errors.push(`"${id}" is not a generator ID`); continue; }
    if (value === null || value === undefined || value === '') continue; // cleared → use fleet default
    const n = Number(value);
    if (isTemperature(n)) vehicleThresholdsC[id] = Math.round(n * 10) / 10;
    else errors.push(`Limit for generator ${id} must be between ${TEMPERATURE_MIN_C} and ${TEMPERATURE_MAX_C} °C`);
  }

  if (enabled && !lenient && to.length + cc.length + bcc.length === 0) {
    errors.push('Add at least one recipient, or switch alert emails off for this fleet');
  }

  return {
    value: { label, enabled, recipients: { to, cc, bcc }, defaultThresholdC, vehicleThresholdsC },
    errors: lenient ? [] : errors,
  };
}

// ─── Reads ────────────────────────────────────────────────────────────────────

/** @returns {Object|null} a copy of one fleet's settings */
function getFleetSettings(fleetId) {
  const fleet = loadStore().fleets[String(fleetId)];
  return fleet ? JSON.parse(JSON.stringify(fleet)) : null;
}

/** @returns {Array<{fleetId:number}&Object>} every configured fleet */
function listFleetSettings() {
  return Object.entries(loadStore().fleets)
    .map(([id, f]) => ({ fleetId: parseInt(id, 10), ...JSON.parse(JSON.stringify(f)) }))
    .sort((a, b) => a.fleetId - b.fleetId);
}

/**
 * Addresses in `addresses` that already receive another fleet's alerts.
 * @returns {Array<{address:string, fleetIds:number[]}>}
 */
function findAddressConflicts(fleetId, addresses) {
  const own = String(fleetId);
  const result = [];
  for (const address of addresses) {
    const fleetIds = Object.entries(loadStore().fleets)
      .filter(([id, f]) => id !== own &&
        [...f.recipients.to, ...f.recipients.cc, ...f.recipients.bcc].includes(address))
      .map(([id]) => parseInt(id, 10));
    if (fleetIds.length > 0) result.push({ address, fleetIds });
  }
  return result;
}

// ─── Writes ───────────────────────────────────────────────────────────────────

/**
 * Create or replace one fleet's settings.
 *
 * @param {number|string} fleetId
 * @param {Object} input - settings from the admin API
 * @param {{expectedRevision?:number|null, actor:string}} meta
 *   expectedRevision: the revision the admin loaded (0 / null for a new fleet).
 * @returns {Object} the saved settings
 * @throws {SettingsValidationError|RevisionConflictError}
 */
function saveFleetSettings(fleetId, input, { expectedRevision = null, actor }) {
  const id = normalizeFleetId(fleetId);
  if (!id) throw new SettingsValidationError(['Fleet ID must be a positive whole number']);

  const { value, errors } = validateFleetSettings(input);
  if (errors.length > 0) throw new SettingsValidationError(errors);

  const store = loadStore();
  const current = store.fleets[String(id)] || null;
  const currentRevision = current ? current.revision : 0;
  if (expectedRevision !== null && expectedRevision !== undefined && Number(expectedRevision) !== currentRevision) {
    throw new RevisionConflictError(current);
  }

  const next = {
    ...value,
    revision: currentRevision + 1,
    updatedAt: new Date().toISOString(),
    updatedBy: actor,
  };
  const updated = { version: STORE_VERSION, fleets: { ...store.fleets, [String(id)]: next } };
  writeJson(storePath(), updated);
  cache = { path: null, mtimeMs: null, store: null }; // re-read on next access
  return { fleetId: id, ...next };
}

/**
 * Remove a fleet's settings (its alerts stop being emailed).
 * @returns {boolean} true when something was removed
 */
function deleteFleetSettings(fleetId, { expectedRevision = null } = {}) {
  const store = loadStore();
  const current = store.fleets[String(fleetId)];
  if (!current) return false;
  if (expectedRevision !== null && expectedRevision !== undefined && Number(expectedRevision) !== current.revision) {
    throw new RevisionConflictError(current);
  }
  const fleets = { ...store.fleets };
  delete fleets[String(fleetId)];
  writeJson(storePath(), { version: STORE_VERSION, fleets });
  cache = { path: null, mtimeMs: null, store: null };
  return true;
}

// ─── Resolution used by the monitor and the dashboard ────────────────────────

/**
 * Temperature limit for a generator.
 * When the fleet is unknown (single-vehicle endpoints), the lowest limit any
 * fleet sets for this generator is used, so an alert is never missed.
 *
 * @param {number|string} vehicleId
 * @param {number|string|null} fleetId
 * @param {Object} [cfg]
 * @returns {number}
 */
function resolveThreshold(vehicleId, fleetId, cfg = getAlertConfig()) {
  const vid = String(vehicleId);
  const fleets = loadStore().fleets;

  if (fleetId !== null && fleetId !== undefined) {
    const fleet = fleets[String(fleetId)];
    if (fleet) {
      if (fleet.vehicleThresholdsC[vid] !== undefined) return fleet.vehicleThresholdsC[vid];
      if (fleet.defaultThresholdC !== null) return fleet.defaultThresholdC;
    }
  } else {
    const overrides = Object.values(fleets)
      .map((f) => f.vehicleThresholdsC[vid])
      .filter((v) => v !== undefined);
    if (overrides.length > 0) return Math.min(...overrides);
  }

  const global = cfg.temperature.vehicleThresholdsC[vid];
  return global !== undefined ? global : cfg.temperature.defaultThresholdC;
}

/**
 * Who receives a fleet's alert emails.
 * @returns {{to:string[], cc:string[], bcc:string[], source:string}}
 */
function resolveRecipients(fleetId, cfg = getAlertConfig()) {
  const none = { to: [], cc: [], bcc: [] };
  const fleet = loadStore().fleets[String(fleetId)];
  if (fleet) {
    if (!fleet.enabled) return { ...none, source: 'paused' };
    return { ...JSON.parse(JSON.stringify(fleet.recipients)), source: 'portal' };
  }
  const fromConfig = cfg.email.recipients.byFleet[String(fleetId)];
  if (fromConfig && fromConfig.to.length > 0) {
    return { to: [...fromConfig.to], cc: [...fromConfig.cc], bcc: [], source: 'alerts.json' };
  }
  if (cfg.email.recipients.defaultForFleetsWithoutRecipients) {
    const d = cfg.email.recipients.default;
    return { to: [...d.to], cc: [...d.cc], bcc: [], source: 'default' };
  }
  return { ...none, source: 'none' };
}

/** Fleets the monitor should check: enabled portal fleets + alerts.json fleets not managed in the portal. */
function monitoredFleetIds(cfg = getAlertConfig()) {
  const fleets = loadStore().fleets;
  const ids = new Set(Object.entries(fleets).filter(([, f]) => f.enabled).map(([id]) => parseInt(id, 10)));
  for (const id of cfg.monitor.fleetIds) if (!fleets[String(id)]) ids.add(id);
  return [...ids].sort((a, b) => a - b);
}

function resetCache() {
  cache = { path: null, mtimeMs: null, store: null };
}

module.exports = {
  getFleetSettings,
  listFleetSettings,
  saveFleetSettings,
  deleteFleetSettings,
  findAddressConflicts,
  validateFleetSettings,
  resolveThreshold,
  resolveRecipients,
  monitoredFleetIds,
  normalizeFleetId,
  SettingsValidationError,
  RevisionConflictError,
  resetCache,
};
