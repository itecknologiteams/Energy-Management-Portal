'use strict';

/**
 * Maintenance service — a generator's service status from its saved
 * settings plus the running hours measured since the last service.
 *
 * Running hours come from the ignition signal (calculateWorkTime), summed
 * day by day from the last service date to today. Past days never change,
 * so their totals are cached in memory; only today is recomputed.
 *
 *   total hours   = hour meter at last service + hours run since
 *   next service  = hour meter at last service + interval hours
 *   due date      = last service date + interval days
 *   status        = overdue | due_soon (≤ DUE_SOON_DAYS / _HOURS left) | ok | not_configured
 */

const fleetService = require('./fleetService');
const { calculateWorkTime } = require('./analyticsService');
const maintenanceRepository = require('../repositories/maintenanceRepository');
const { getTrackingData, TrackingTableNotFoundError } = require('../repositories/trackingRepository');
const { ValidationError, NotFoundError } = require('../utils/errors');
const { TRACKING_TIME_OFFSET_MS } = require('../constants');

const DAY_MS = 24 * 60 * 60 * 1000;
const DUE_SOON_DAYS = 7;
const DUE_SOON_HOURS = 50;
const MAX_HISTORY_DAYS = 400;   // how far back running hours are summed
const DAY_FETCH_CONCURRENCY = 6;

// "vehicleId:YYYY-MM-DD" → minutes run that (finished) day
const pastDayMinutes = new Map();

const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
// Today on the tracking tables' clock (PKT wall time read as UTC)
const trackingToday = () => new Date(Date.now() + TRACKING_TIME_OFFSET_MS).toISOString().slice(0, 10);

/**
 * Validate settings from a request body. Every field is optional; an empty
 * value clears it.
 *
 * @param {Object} body
 * @returns {Object} clean settings
 * @throws {ValidationError}
 */
function validateSettings(body) {
  const settings = {};
  const empty = (v) => v === undefined || v === null || v === '';

  if (!empty(body?.model)) {
    const model = String(body.model).trim();
    if (model.length > 60) throw new ValidationError('model must be at most 60 characters', 'model');
    settings.model = model;
  }

  if (!empty(body?.lastServiceDate)) {
    if (!isDate(body.lastServiceDate)) throw new ValidationError('lastServiceDate must be YYYY-MM-DD', 'lastServiceDate');
    if (body.lastServiceDate > trackingToday()) throw new ValidationError('lastServiceDate cannot be in the future', 'lastServiceDate');
    settings.lastServiceDate = body.lastServiceDate;
  }

  const numberField = (name, { min, max, integer }) => {
    if (empty(body?.[name])) return;
    const value = Number(body[name]);
    if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
      throw new ValidationError(`${name} must be a ${integer ? 'whole ' : ''}number from ${min} to ${max}`, name);
    }
    settings[name] = value;
  };
  numberField('hourMeterAtLastService', { min: 0, max: 1000000 });
  numberField('serviceIntervalHours', { min: 1, max: 100000 });
  numberField('serviceIntervalDays', { min: 1, max: 3650, integer: true });

  return settings;
}

async function assertFleetVehicle(fleetId, vehicleId) {
  const { vehicles } = await fleetService.getFleetVehicles(fleetId);
  const vehicle = vehicles.find((v) => parseInt(v.vehicleId, 10) === vehicleId);
  if (!vehicle) throw new NotFoundError('Vehicle in this fleet', vehicleId);
  return vehicle;
}

async function minutesRunOn(vehicleId, date, today) {
  const key = `${vehicleId}:${date}`;
  if (date < today && pastDayMinutes.has(key)) return pastDayMinutes.get(key);

  let minutes = 0;
  try {
    minutes = calculateWorkTime(await getTrackingData(vehicleId, date)) || 0;
  } catch (err) {
    if (!(err instanceof TrackingTableNotFoundError)) throw err;
  }
  if (date < today) pastDayMinutes.set(key, minutes);
  return minutes;
}

/**
 * Hours run on each day from `from` to today, fetched a few days at a time.
 *
 * @returns {Promise<{ total: number, today: number }>} hours
 */
async function hoursRunSince(vehicleId, from) {
  const today = trackingToday();
  const days = Math.min(daysBetween(from, today), MAX_HISTORY_DAYS);
  const dates = Array.from({ length: days + 1 }, (_, i) => addDays(today, -days + i));

  const minutes = [];
  for (let i = 0; i < dates.length; i += DAY_FETCH_CONCURRENCY) {
    const batch = dates.slice(i, i + DAY_FETCH_CONCURRENCY);
    minutes.push(...await Promise.all(batch.map((d) => minutesRunOn(vehicleId, d, today))));
  }
  const total = minutes.reduce((s, m) => s + m, 0) / 60;
  return { total, today: (minutes[minutes.length - 1] || 0) / 60 };
}

const round1 = (n) => Math.round(n * 10) / 10;

/**
 * @param {number} fleetId
 * @param {number} vehicleId
 * @returns {Promise<Object>} settings plus the computed status
 */
async function getMaintenance(fleetId, vehicleId) {
  await assertFleetVehicle(fleetId, vehicleId);
  const settings = await maintenanceRepository.getSettings(fleetId, vehicleId);
  const today = trackingToday();

  // Today's hours are always useful; the full history only once a service
  // date says where to start counting
  const run = settings.lastServiceDate
    ? await hoursRunSince(vehicleId, settings.lastServiceDate)
    : { total: null, today: (await minutesRunOn(vehicleId, today, today)) / 60 };

  const result = {
    settings,
    hoursToday: round1(run.today),
    hoursSinceService: run.total === null ? null : round1(run.total),
    totalHours: null,
    nextServiceHours: null,
    hoursLeft: null,
    dueDate: null,
    daysLeft: null,
    status: 'not_configured',
  };

  if (settings.lastServiceDate && settings.hourMeterAtLastService !== undefined) {
    result.totalHours = round1(settings.hourMeterAtLastService + run.total);
    if (settings.serviceIntervalHours) {
      result.nextServiceHours = round1(settings.hourMeterAtLastService + settings.serviceIntervalHours);
      result.hoursLeft = round1(result.nextServiceHours - result.totalHours);
    }
  }
  if (settings.lastServiceDate && settings.serviceIntervalDays) {
    result.dueDate = addDays(settings.lastServiceDate, settings.serviceIntervalDays);
    result.daysLeft = daysBetween(today, result.dueDate);
  }

  if (result.hoursLeft !== null || result.daysLeft !== null) {
    const overdue = (result.hoursLeft !== null && result.hoursLeft < 0) || (result.daysLeft !== null && result.daysLeft < 0);
    const dueSoon = (result.hoursLeft !== null && result.hoursLeft <= DUE_SOON_HOURS) ||
      (result.daysLeft !== null && result.daysLeft <= DUE_SOON_DAYS);
    result.status = overdue ? 'overdue' : dueSoon ? 'due_soon' : 'ok';
  }

  return result;
}

/**
 * @param {number} fleetId
 * @param {number} vehicleId
 * @param {Object} body - settings from the dashboard
 * @returns {Promise<Object>} as getMaintenance
 */
async function saveMaintenance(fleetId, vehicleId, body) {
  await assertFleetVehicle(fleetId, vehicleId);
  await maintenanceRepository.saveSettings(fleetId, vehicleId, validateSettings(body));
  return getMaintenance(fleetId, vehicleId);
}

module.exports = {
  getMaintenance,
  saveMaintenance,
  validateSettings,
};
