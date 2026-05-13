'use strict';

/**
 * Fleet service — orchestrates repository calls and business logic for fleet operations.
 */

const fleetRepository = require('../repositories/fleetRepository');
const sensorRepository = require('../repositories/sensorRepository');
const sensorMapper = require('../helpers/sensorMapper');
const { NO_FUEL_SENSOR_VEHICLE_IDS } = require('../constants');

/**
 * Validate that a value is a positive integer.
 *
 * @param {*} value
 * @param {string} fieldName
 * @returns {number} Validated integer
 * @throws {Error} If validation fails
 */
function validatePositiveInteger(value, fieldName) {
  const num = parseInt(value, 10);

  if (Number.isNaN(num) || num <= 0) {
    const err = new Error(`${fieldName} must be a positive integer`);
    err.status = 400;
    throw err;
  }

  return num;
}

/**
 * Get all vehicles for a given fleet with their IDs and names.
 *
 * @param {number|string} fleetId
 * @returns {Promise<{fleetId: number, vehicles: Array<{vehicleId: number, vehicleName: string}>, count: number}>}
 * @throws {Error} If fleet not found or has no vehicles
 */
async function getFleetVehicles(fleetId) {
  const validatedFleetId = validatePositiveInteger(fleetId, 'fleetId');

  const vehicles = await fleetRepository.getVehiclesByFleetId(validatedFleetId);

  if (!vehicles || vehicles.length === 0) {
    const err = new Error(`No vehicles found for fleet ${validatedFleetId}`);
    err.status = 404;
    throw err;
  }

  return {
    fleetId: validatedFleetId,
    vehicles,
    count: vehicles.length,
  };
}

/**
 * Get a single vehicle with its resolved sensor mappings.
 *
 * @param {number|string} vehicleId
 * @returns {Promise<{vehicleId: number, sensors: Object}>}
 * @throws {Error} If vehicleId invalid or sensor mapping not found
 */
async function getVehicleWithSensors(vehicleId) {
  const validatedVehicleId = validatePositiveInteger(vehicleId, 'vehicleId');

  // Fetch sensor mappings from tracking database
  const mappingRows = await sensorRepository.getSensorMappingsByVehicleId(validatedVehicleId);

  if (!mappingRows || mappingRows.length === 0) {
    console.warn(`[fleetService] No sensor mappings found for vehicle ${validatedVehicleId}, using defaults`);
  }

  // Resolve the mapping rows into structured sensor keys
  const sensors = sensorMapper.resolveSensorKeys(mappingRows);

  return {
    vehicleId: validatedVehicleId,
    sensors,
  };
}

/**
 * Get all vehicles for a fleet with their sensor mappings.
 * This is useful for bulk operations.
 *
 * @param {number|string} fleetId
 * @returns {Promise<{fleetId: number, vehicles: Array}>}
 */
async function getFleetVehiclesWithSensors(fleetId) {
  const { fleetId: validatedFleetId, vehicles } = await getFleetVehicles(fleetId);

  // Fetch sensor mappings for all vehicles in parallel
  const vehiclesWithSensors = await Promise.all(
    vehicles.map(async ({ vehicleId, vehicleName }) => {
      try {
        const { sensors } = await getVehicleWithSensors(vehicleId);
        return {
          vehicleId,
          vehicleName,
          sensors: {
            ...sensors,
            fuelChartExcluded: NO_FUEL_SENSOR_VEHICLE_IDS.includes(parseInt(vehicleId, 10)),
          },
        };
      } catch (err) {
        console.error(`[fleetService] Failed to get sensors for vehicle ${vehicleId}:`, err.message);
        return {
          vehicleId,
          vehicleName,
          sensors: null,
          error: err.message,
        };
      }
    })
  );

  return {
    fleetId: validatedFleetId,
    vehicles: vehiclesWithSensors,
    count: vehiclesWithSensors.length,
  };
}

module.exports = {
  getFleetVehicles,
  getVehicleWithSensors,
  getFleetVehiclesWithSensors,
};
