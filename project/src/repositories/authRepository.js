'use strict';

/**
 * Auth repository — handles all CRM database queries for fleet login authentication.
 */

const { getPool } = require('../db/crmDb');
const { CRM_FLEET_LOGIN_TABLE } = require('../constants');

/**
 * Verify fleet login credentials from the FleetLogin table.
 *
 * @param {string} username - AZ_WebTrackId
 * @param {string} password - AZ_WebTrackPassword
 * @returns {Promise<Object|null>} User object if credentials match, null otherwise
 */
async function verifyCredentials(username, password) {
  const pool = await getPool();

  try {
    const query = `
      SELECT 
        [FleetId],
        [WebTrackId],
        [WebTrackPassword],
        [IsEnabled],
        [CreationDate],
        [ModificationDate]
      FROM ${CRM_FLEET_LOGIN_TABLE}
      WHERE [WebTrackId] = @username
        AND [WebTrackPassword] = @password
        AND [IsEnabled] = 1
    `;

    const result = await pool
      .request()
      .input('username', username)
      .input('password', password)
      .query(query);

    if (result.recordset.length === 0) {
      return null;
    }

    const user = result.recordset[0];

    // Return user info without password
    return {
      fleetId: user['FleetId'],
      username: user['WebTrackId'],
      isEnabled: user['IsEnabled'],
      createdAt: user['CreationDate'],
      updatedAt: user['ModificationDate'],
    };
  } catch (err) {
    console.error('[authRepository] Error verifying credentials:', err.message);
    throw err;
  }
}

/**
 * Get user by username (for checking if user exists).
 *
 * @param {string} username - AZ_WebTrackId
 * @returns {Promise<Object|null>} User object if found, null otherwise
 */
async function getUserByUsername(username) {
  const pool = await getPool();

  try {
    const query = `
      SELECT 
        [FleetId],
        [AZ WebTrackId],
        [IsEnabled],
        [CreationDate],
        [ModificationDate]
      FROM ${CRM_FLEET_LOGIN_TABLE}
      WHERE [AZ WebTrackId] = @username
    `;

    const result = await pool
      .request()
      .input('username', username)
      .query(query);

    if (result.recordset.length === 0) {
      return null;
    }

    const user = result.recordset[0];

    return {
      fleetId: user['FleetId'],
      username: user['AZ WebTrackId'],
      isEnabled: user['IsEnabled'],
      createdAt: user['CreationDate'],
      updatedAt: user['ModificationDate'],
    };
  } catch (err) {
    console.error('[authRepository] Error fetching user by username:', err.message);
    throw err;
  }
}

module.exports = {
  verifyCredentials,
  getUserByUsername,
};
