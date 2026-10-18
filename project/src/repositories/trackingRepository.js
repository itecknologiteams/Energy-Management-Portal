'use strict';

/**
 * Tracking repository — handles all queries to daily tracking tables (TrackDataYYYYMMDD).
 */

const { getPool } = require('../db/trackingDb');
const {
  dateToTableName,
  validateDateFormat,
  tableExists,
} = require('../helpers/trackingTableHelper');
const {
  TRACKING_VEHICLE_COLUMN,
  TRACKING_TIMESTAMP_COLUMN,
  TRACKING_PARAMS_COLUMN,
  TRACKING_BATTERY_COLUMN,
  TRACKING_BACKUP_BATTERY_COLUMN,
  TRACKING_POWER_VOLT_COLUMN,
  TRACKING_FUEL_COLUMN,
  TRACKING_IGNITION_COLUMN,
  TRACKING_ENGINE_CUT_COLUMN,
} = require('../constants');
const { TrackingTableNotFoundError, DatabaseError } = require('../utils/errors');

/**
 * Retrieve tracking data for a vehicle on a specific date.
 *
 * @param {number} vehicleId — Vehicle ID (V_Id)
 * @param {string} date — Date in format "YYYY-MM-DD"
 * @returns {Promise<Array<{timestamp: Date, params: string, vehicleId: number}>>} Array of tracking records
 * @throws {TrackingTableNotFoundError} If the table for the date doesn't exist
 * @throws {DatabaseError} If a database error occurs
 */
async function getTrackingData(vehicleId, date) {
  // Validate inputs
  if (!vehicleId || typeof vehicleId !== 'number' || vehicleId <= 0) {
    throw new Error('vehicleId must be a positive number');
  }

  if (!validateDateFormat(date)) {
    throw new Error(`Invalid date format: ${date}. Expected YYYY-MM-DD.`);
  }

  const pool = await getPool();
  const tableName = dateToTableName(date);

  // Check if table exists
  const exists = await tableExists(pool, tableName);
  if (!exists) {
    throw new TrackingTableNotFoundError(tableName, date);
  }

  try {
    // Build and execute query with parameterized inputs
    // Fetch dedicated columns + params for fallback
    const query = `
      SELECT
        ${TRACKING_TIMESTAMP_COLUMN} AS timestamp,
        ${TRACKING_VEHICLE_COLUMN} AS vehicleId,
        ${TRACKING_BATTERY_COLUMN} AS battery,
        ${TRACKING_BACKUP_BATTERY_COLUMN} AS backupBattery,
        ${TRACKING_POWER_VOLT_COLUMN} AS powerVolt,
        ${TRACKING_FUEL_COLUMN} AS fuelLevel,
        ${TRACKING_IGNITION_COLUMN} AS ignition,
        ${TRACKING_ENGINE_CUT_COLUMN} AS engineCut,
        ${TRACKING_PARAMS_COLUMN} AS params
      FROM dbo.${tableName}
      WHERE ${TRACKING_VEHICLE_COLUMN} = @vehicleId
      ORDER BY ${TRACKING_TIMESTAMP_COLUMN} ASC
    `;

    const result = await pool
      .request()
      .input('vehicleId', vehicleId)
      .query(query);

    return result.recordset.map((row) => ({
      timestamp: row.timestamp,
      vehicleId: row.vehicleId,
      battery: row.battery,
      backupBattery: row.backupBattery,
      powerVolt: row.powerVolt,
      fuelLevel: row.fuelLevel,
      ignition: row.ignition,
      engineCut: row.engineCut,
      params: row.params,
    }));
  } catch (err) {
    console.error('[trackingRepository] Error fetching tracking data:', err.message);

    // Classify error type
    if (err.message && err.message.includes('Invalid object name')) {
      // Table was deleted between existence check and query
      throw new TrackingTableNotFoundError(tableName, date);
    }

    throw new DatabaseError(
      `Failed to retrieve tracking data for vehicle ${vehicleId} on ${date}`,
      err
    );
  }
}

/**
 * Retrieve tracking data for a vehicle within a time range on a specific date.
 * Useful for filtering to working hours or specific trip times.
 *
 * @param {number} vehicleId — Vehicle ID
 * @param {string} date — Date in format "YYYY-MM-DD"
 * @param {string} startTime — Start time in "HH:MM:SS" format (inclusive)
 * @param {string} endTime — End time in "HH:MM:SS" format (inclusive)
 * @returns {Promise<Array>} Array of tracking records within the time range
 * @throws {TrackingTableNotFoundError} If the table for the date doesn't exist
 */
async function getTrackingDataInRange(vehicleId, date, startTime, endTime) {
  if (!vehicleId || typeof vehicleId !== 'number' || vehicleId <= 0) {
    throw new Error('vehicleId must be a positive number');
  }

  if (!validateDateFormat(date)) {
    throw new Error(`Invalid date format: ${date}. Expected YYYY-MM-DD.`);
  }

  const pool = await getPool();
  const tableName = dateToTableName(date);

  const exists = await tableExists(pool, tableName);
  if (!exists) {
    throw new TrackingTableNotFoundError(tableName, date);
  }

  try {
    const query = `
      SELECT
        ${TRACKING_TIMESTAMP_COLUMN} AS timestamp,
        ${TRACKING_PARAMS_COLUMN} AS params,
        ${TRACKING_VEHICLE_COLUMN} AS vehicleId
      FROM dbo.${tableName}
      WHERE ${TRACKING_VEHICLE_COLUMN} = @vehicleId
        AND CAST(${TRACKING_TIMESTAMP_COLUMN} AS TIME) BETWEEN @startTime AND @endTime
      ORDER BY ${TRACKING_TIMESTAMP_COLUMN} ASC
    `;

    const result = await pool
      .request()
      .input('vehicleId', vehicleId)
      .input('startTime', startTime)
      .input('endTime', endTime)
      .query(query);

    return result.recordset.map((row) => ({
      timestamp: row.timestamp,
      params: row.params,
      vehicleId: row.vehicleId,
    }));
  } catch (err) {
    console.error('[trackingRepository] Error fetching tracking data in range:', err.message);
    throw new DatabaseError(
      `Failed to retrieve tracking data range for vehicle ${vehicleId} on ${date}`,
      err
    );
  }
}

/**
 * Get the count of records for a vehicle on a specific date.
 * Useful for estimating data volume before full retrieval.
 *
 * @param {number} vehicleId — Vehicle ID
 * @param {string} date — Date in format "YYYY-MM-DD"
 * @returns {Promise<number>} Record count
 * @throws {TrackingTableNotFoundError} If the table doesn't exist
 */
async function getTrackingDataCount(vehicleId, date) {
  if (!vehicleId || typeof vehicleId !== 'number' || vehicleId <= 0) {
    throw new Error('vehicleId must be a positive number');
  }

  if (!validateDateFormat(date)) {
    throw new Error(`Invalid date format: ${date}. Expected YYYY-MM-DD.`);
  }

  const pool = await getPool();
  const tableName = dateToTableName(date);

  const exists = await tableExists(pool, tableName);
  if (!exists) {
    throw new TrackingTableNotFoundError(tableName, date);
  }

  try {
    const query = `
      SELECT COUNT(*) AS count
      FROM dbo.${tableName}
      WHERE ${TRACKING_VEHICLE_COLUMN} = @vehicleId
    `;

    const result = await pool
      .request()
      .input('vehicleId', vehicleId)
      .query(query);

    return result.recordset[0].count;
  } catch (err) {
    console.error('[trackingRepository] Error counting tracking data:', err.message);
    throw new DatabaseError(
      `Failed to count tracking data for vehicle ${vehicleId} on ${date}`,
      err
    );
  }
}

// Re-export the error class for consumers
const { TrackingTableNotFoundError: TrackingTableNotFoundErrorClass } = require('../utils/errors');

module.exports = {
  getTrackingData,
  getTrackingDataInRange,
  getTrackingDataCount,
  TrackingTableNotFoundError: TrackingTableNotFoundErrorClass,
};
