'use strict';

/**
 * Sensor repository — handles all CRM database queries for sensor mappings.
 * Note: VehicleSensors table is in the CRM database, not Tracking.
 */

const { getPool } = require('../db/crmDb');
const { CRM_SENSOR_MAPPING_TABLE } = require('../constants');

/**
 * Retrieve sensor mapping rows for a specific vehicle.
 * A vehicle may have multiple sensors (fuel1, fuel2, etc.).
 *
 * @param {number} vehicleId
 * @returns {Promise<Object[]>} Array of sensor mapping rows
 */
async function getSensorMappingsByVehicleId(vehicleId) {
  const pool = await getPool();

  try {
    const query = `
      SELECT VehicleId, Name, Min, Max, Formula, Unit, Calibration, param
      FROM ${CRM_SENSOR_MAPPING_TABLE}
      WHERE VehicleId = @vehicleId
    `;

    const result = await pool
      .request()
      .input('vehicleId', vehicleId)
      .query(query);

    return result.recordset;
  } catch (err) {
    console.error('[sensorRepository] Error fetching sensor mappings:', err.message);
    throw err;
  }
}

/**
 * Retrieve a single sensor mapping row by vehicle and specific param name.
 * Useful when looking for a specific sensor like 'fuel1'.
 *
 * @param {number} vehicleId
 * @param {string} paramName — e.g., 'fuel1', 'fuel2'
 * @returns {Promise<Object|null>} Sensor mapping row or null
 */
async function getSensorMappingByParam(vehicleId, paramName) {
  const pool = await getPool();

  try {
    const query = `
      SELECT VehicleId, Name, Min, Max, Formula, Unit, Calibration, param
      FROM ${CRM_SENSOR_MAPPING_TABLE}
      WHERE VehicleId = @vehicleId AND param = @paramName
    `;

    const result = await pool
      .request()
      .input('vehicleId', vehicleId)
      .input('paramName', paramName)
      .query(query);

    return result.recordset.length > 0 ? result.recordset[0] : null;
  } catch (err) {
    console.error('[sensorRepository] Error fetching sensor mapping by param:', err.message);
    throw err;
  }
}

module.exports = {
  getSensorMappingsByVehicleId,
  getSensorMappingByParam,
};
