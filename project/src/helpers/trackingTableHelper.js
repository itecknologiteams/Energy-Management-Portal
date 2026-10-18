'use strict';

/**
 * Tracking table helper — utilities for managing daily tracking table names.
 * Tracking tables follow the pattern: TrackDataYYYYMMDD
 */

const { TRACKING_DATA_TABLE_PREFIX } = require('../constants');

/**
 * Convert a date string (YYYY-MM-DD) to a tracking table name.
 *
 * @param {string} dateStr — Date in format "2026-04-15"
 * @returns {string} Table name, e.g., "TrackData20260415"
 * @throws {Error} If date format is invalid
 */
function dateToTableName(dateStr) {
  if (!validateDateFormat(dateStr)) {
    throw new Error(`Invalid date format: ${dateStr}. Expected YYYY-MM-DD.`);
  }

  // Remove dashes from YYYY-MM-DD → YYYYMMDD
  const datePart = dateStr.replace(/-/g, '');
  return `${TRACKING_DATA_TABLE_PREFIX}${datePart}`;
}

/**
 * Validate that a string is in YYYY-MM-DD format.
 * Also validates that it's a real calendar date (e.g., rejects 2026-02-30).
 *
 * @param {string} dateStr — Date string to validate
 * @returns {boolean} True if valid, false otherwise
 */
function validateDateFormat(dateStr) {
  if (typeof dateStr !== 'string') {
    return false;
  }

  // Regex pattern for YYYY-MM-DD
  const pattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!pattern.test(dateStr)) {
    return false;
  }

  // Parse and validate it's a real date
  const [year, month, day] = dateStr.split('-').map(Number);

  // Basic range checks
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;

  // Create date object and verify it matches input (catches invalid dates like Feb 30)
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return false;
  }

  return true;
}

/**
 * Check if a tracking table exists in the database.
 *
 * @param {import('mssql').ConnectionPool} pool — SQL Server connection pool
 * @param {string} tableName — Table name to check (e.g., "TrackData20260415")
 * @returns {Promise<boolean>} True if table exists, false otherwise
 */
async function tableExists(pool, tableName) {
  try {
    const result = await pool
      .request()
      .input('tableName', tableName)
      .query(`
        SELECT COUNT(*) AS count
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_NAME = @tableName
      `);

    return result.recordset[0].count > 0;
  } catch (err) {
    console.error('[trackingTableHelper] Error checking table existence:', err.message);
    throw err;
  }
}

/**
 * Get the most recent tracking table name available.
 * Useful when you need the latest data without knowing the exact date.
 *
 * @param {import('mssql').ConnectionPool} pool — SQL Server connection pool
 * @param {number} [lookbackDays=7] — How many days back to search
 * @returns {Promise<string|null>} Most recent table name or null if none found
 */
async function getMostRecentTable(pool, lookbackDays = 7) {
  const today = new Date();

  for (let i = 0; i < lookbackDays; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);

    const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
    const tableName = dateToTableName(dateStr);

    const exists = await tableExists(pool, tableName);
    if (exists) {
      return tableName;
    }
  }

  return null;
}

module.exports = {
  dateToTableName,
  validateDateFormat,
  tableExists,
  getMostRecentTable,
};
