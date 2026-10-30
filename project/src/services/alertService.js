'use strict';

/**
 * Alert service — validates dashboard alert rules and checks them against
 * each vehicle's current reading.
 *
 * A rule: { vehicleId (null = every vehicle in the fleet), metric
 * ('temperature'), operator ('above' | 'below'), threshold (°C), enabled }.
 * Only readings from the last ALERT_STALE_MINUTES count, so a device that
 * went silent while hot does not keep an alert open indefinitely.
 */

const fleetService = require('./fleetService');
const { calculateTemperature } = require('./analyticsService');
const alertRuleRepository = require('../repositories/alertRuleRepository');
const { getLatestRowsForVehicles } = require('../repositories/trackingRepository');
const { ValidationError, NotFoundError } = require('../utils/errors');
const {
  TEMPERATURE_MIN_C,
  TEMPERATURE_MAX_C,
  TRACKING_TIME_OFFSET_MS,
  ALERT_STALE_MINUTES,
} = require('../constants');

const METRICS = ['temperature'];
const OPERATORS = ['above', 'below'];

/**
 * Validate rule fields from a request body. With `partial`, only the fields
 * present are checked (for updates).
 *
 * @param {Object} body
 * @param {number[]} fleetVehicleIds - vehicles a rule may target
 * @param {boolean} [partial=false]
 * @returns {Object} clean fields
 * @throws {ValidationError}
 */
function validateRuleFields(body, fleetVehicleIds, partial = false) {
  const fields = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(body || {}, k);

  if (!partial || has('metric')) {
    const metric = body?.metric ?? 'temperature';
    if (!METRICS.includes(metric)) throw new ValidationError(`metric must be one of: ${METRICS.join(', ')}`, 'metric');
    fields.metric = metric;
  }

  if (!partial || has('operator')) {
    if (!OPERATORS.includes(body?.operator)) throw new ValidationError(`operator must be one of: ${OPERATORS.join(', ')}`, 'operator');
    fields.operator = body.operator;
  }

  if (!partial || has('threshold')) {
    const threshold = Number(body?.threshold);
    if (body?.threshold === '' || body?.threshold === null || !Number.isFinite(threshold) ||
        threshold < TEMPERATURE_MIN_C || threshold > TEMPERATURE_MAX_C) {
      throw new ValidationError(`threshold must be a number between ${TEMPERATURE_MIN_C} and ${TEMPERATURE_MAX_C} °C`, 'threshold');
    }
    fields.threshold = threshold;
  }

  if (!partial || has('vehicleId')) {
    const raw = body?.vehicleId;
    if (raw === null || raw === undefined || raw === '' || raw === 'all') {
      fields.vehicleId = null;
    } else {
      const vehicleId = parseInt(raw, 10);
      if (!fleetVehicleIds.includes(vehicleId)) throw new ValidationError('vehicleId is not a vehicle of this fleet', 'vehicleId');
      fields.vehicleId = vehicleId;
    }
  }

  if (!partial || has('enabled')) {
    const enabled = body?.enabled ?? true;
    if (typeof enabled !== 'boolean') throw new ValidationError('enabled must be true or false', 'enabled');
    fields.enabled = enabled;
  }

  return fields;
}

async function getFleetVehicleIds(fleetId) {
  const { vehicles } = await fleetService.getFleetVehicles(fleetId);
  return vehicles.map((v) => parseInt(v.vehicleId, 10));
}

async function listRules(fleetId) {
  return alertRuleRepository.listRules(fleetId);
}

async function createRule(fleetId, body) {
  const fields = validateRuleFields(body, await getFleetVehicleIds(fleetId));
  return alertRuleRepository.createRule(fleetId, fields);
}

async function updateRule(fleetId, ruleId, body) {
  const fields = validateRuleFields(body, await getFleetVehicleIds(fleetId), true);
  const rule = await alertRuleRepository.updateRule(fleetId, ruleId, fields);
  if (!rule) throw new NotFoundError('Alert rule', ruleId);
  return rule;
}

async function deleteRule(fleetId, ruleId) {
  const removed = await alertRuleRepository.deleteRule(fleetId, ruleId);
  if (!removed) throw new NotFoundError('Alert rule', ruleId);
}

/**
 * "YYYY-MM-DD" of a PKT-as-UTC instant (the tracking tables' clock).
 */
function trackingDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Each vehicle's current temperature: its latest row today, or yesterday's
 * just after midnight before today's first row arrives.
 *
 * @param {number[]} vehicleIds
 * @param {number} nowMs - now on the tracking clock
 * @returns {Promise<Map<number, {temperature:number|null, at:Date}>>}
 */
async function getCurrentTemperatures(vehicleIds, nowMs) {
  const today = await getLatestRowsForVehicles(vehicleIds, trackingDate(nowMs));
  const missing = vehicleIds.filter((id) => !today.has(id));
  const yesterday = missing.length
    ? await getLatestRowsForVehicles(missing, trackingDate(nowMs - 24 * 60 * 60 * 1000))
    : new Map();

  const readings = new Map();
  for (const [id, row] of [...yesterday, ...today]) {
    readings.set(id, { temperature: calculateTemperature([row]), at: new Date(row.timestamp) });
  }
  return readings;
}

/**
 * Check a fleet's enabled rules against current readings.
 *
 * @param {number} fleetId
 * @returns {Promise<{checkedAt:string, ruleCount:number, triggered:Object[]}>}
 */
async function checkFleetAlerts(fleetId) {
  const rules = (await alertRuleRepository.listRules(fleetId)).filter((r) => r.enabled);
  const nowMs = Date.now() + TRACKING_TIME_OFFSET_MS;
  const checkedAt = new Date(nowMs).toISOString();
  if (rules.length === 0) return { checkedAt, ruleCount: 0, triggered: [] };

  const { vehicles } = await fleetService.getFleetVehicles(fleetId);
  const names = new Map(vehicles.map((v) => [parseInt(v.vehicleId, 10), v.vehicleName]));
  const wanted = rules.some((r) => r.vehicleId === null)
    ? [...names.keys()]
    : [...new Set(rules.map((r) => r.vehicleId))].filter((id) => names.has(id));

  const readings = await getCurrentTemperatures(wanted, nowMs);
  const freshAfter = nowMs - ALERT_STALE_MINUTES * 60 * 1000;

  const triggered = [];
  for (const rule of rules) {
    const targets = rule.vehicleId === null ? wanted : [rule.vehicleId];
    for (const vehicleId of targets) {
      const reading = readings.get(vehicleId);
      if (!reading || reading.temperature === null || reading.at.getTime() < freshAfter) continue;
      const breached = rule.operator === 'above'
        ? reading.temperature > rule.threshold
        : reading.temperature < rule.threshold;
      if (!breached) continue;
      triggered.push({
        ruleId: rule.id,
        vehicleId,
        vehicleName: names.get(vehicleId) || String(vehicleId),
        metric: rule.metric,
        operator: rule.operator,
        threshold: rule.threshold,
        value: reading.temperature,
        at: reading.at.toISOString(),
      });
    }
  }

  return { checkedAt, ruleCount: rules.length, triggered };
}

module.exports = {
  listRules,
  createRule,
  updateRule,
  deleteRule,
  checkFleetAlerts,
  validateRuleFields,
};
