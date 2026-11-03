'use strict';

/**
 * Maintenance repository — per-generator service settings entered from the
 * dashboard, stored beside the API (the CRM has no maintenance data):
 *
 *   { "2086": { "413532": { model, lastServiceDate, hourMeterAtLastService,
 *                           serviceIntervalHours, serviceIntervalDays, updatedAt } } }
 */

const path = require('path');
const { createJsonFileStore } = require('../helpers/jsonFileStore');

const store = createJsonFileStore(
  process.env.MAINTENANCE_FILE || path.join(__dirname, '..', '..', 'data', 'maintenance.json')
);

/**
 * @param {number} fleetId
 * @param {number} vehicleId
 * @returns {Promise<Object>} the vehicle's settings ({} when none are saved)
 */
async function getSettings(fleetId, vehicleId) {
  const data = await store.read();
  return data[String(fleetId)]?.[String(vehicleId)] || {};
}

/**
 * Replace a vehicle's settings.
 *
 * @param {number} fleetId
 * @param {number} vehicleId
 * @param {Object} settings - validated settings
 * @returns {Promise<Object>} the stored settings
 */
function saveSettings(fleetId, vehicleId, settings) {
  return store.update((data) => {
    const fleetKey = String(fleetId);
    data[fleetKey] = data[fleetKey] || {};
    const saved = { ...settings, updatedAt: new Date().toISOString() };
    data[fleetKey][String(vehicleId)] = saved;
    return saved;
  });
}

module.exports = {
  getSettings,
  saveSettings,
};
