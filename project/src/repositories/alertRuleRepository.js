'use strict';

/**
 * Alert rule repository — stores dashboard-configured alert rules in a JSON
 * file on the API server, grouped by fleet:
 *
 *   { "2086": [ { id, vehicleId, metric, operator, threshold, enabled, ... } ] }
 *
 * The CRM/Tracking databases are shared production systems, so rules live
 * beside the API instead. Writes are serialised and go through a temp file +
 * rename, so a crash mid-write never leaves a half-written file.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RULES_FILE = process.env.ALERT_RULES_FILE
  || path.join(__dirname, '..', '..', 'data', 'alert-rules.json');

// Every write waits for the previous one, so concurrent requests cannot
// overwrite each other's changes.
let writeQueue = Promise.resolve();

async function readAll() {
  try {
    const text = await fs.promises.readFile(RULES_FILE, 'utf8');
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

async function writeAll(data) {
  await fs.promises.mkdir(path.dirname(RULES_FILE), { recursive: true });
  const tmp = `${RULES_FILE}.${process.pid}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fs.promises.rename(tmp, RULES_FILE);
}

/**
 * Apply `change` to the stored rules and save, one change at a time.
 *
 * @param {(data: Object) => any} change - mutates data, returns the result
 * @returns {Promise<any>} whatever `change` returned
 */
function update(change) {
  const run = writeQueue.then(async () => {
    const data = await readAll();
    const result = change(data);
    await writeAll(data);
    return result;
  });
  // Keep the queue alive even if this change fails
  writeQueue = run.catch(() => {});
  return run;
}

/**
 * @returns {Promise<Object>} every fleet's rules, keyed by fleet ID
 */
async function listAllRules() {
  return readAll();
}

/**
 * @param {number} fleetId
 * @returns {Promise<Object[]>} the fleet's rules, oldest first
 */
async function listRules(fleetId) {
  const data = await readAll();
  return data[String(fleetId)] || [];
}

/**
 * @param {number} fleetId
 * @param {Object} fields - validated rule fields
 * @returns {Promise<Object>} the stored rule
 */
function createRule(fleetId, fields) {
  return update((data) => {
    const now = new Date().toISOString();
    const rule = { id: crypto.randomUUID(), ...fields, createdAt: now, updatedAt: now };
    const key = String(fleetId);
    data[key] = [...(data[key] || []), rule];
    return rule;
  });
}

/**
 * @param {number} fleetId
 * @param {string} ruleId
 * @param {Object} fields - validated fields to change
 * @returns {Promise<Object|null>} the updated rule, or null if not found
 */
function updateRule(fleetId, ruleId, fields) {
  return update((data) => {
    const rules = data[String(fleetId)] || [];
    const rule = rules.find((r) => r.id === ruleId);
    if (!rule) return null;
    Object.assign(rule, fields, { updatedAt: new Date().toISOString() });
    return rule;
  });
}

/**
 * @param {number} fleetId
 * @param {string} ruleId
 * @returns {Promise<boolean>} true if a rule was removed
 */
function deleteRule(fleetId, ruleId) {
  return update((data) => {
    const key = String(fleetId);
    const rules = data[key] || [];
    const kept = rules.filter((r) => r.id !== ruleId);
    data[key] = kept;
    return kept.length !== rules.length;
  });
}

module.exports = {
  RULES_FILE,
  listAllRules,
  listRules,
  createRule,
  updateRule,
  deleteRule,
};
