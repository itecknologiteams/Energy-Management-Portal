'use strict';

const sql = require('mssql');
const { trackingConfig } = require('../config/dbConfig');

const RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 3_000;

let pool = null;

/**
 * Returns the existing Tracking connection pool, creating it on first call.
 * Retries up to RETRY_ATTEMPTS times with a delay on failure.
 *
 * @returns {Promise<sql.ConnectionPool>}
 */
async function getPool() {
  if (pool && pool.connected) return pool;

  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      console.log(`[Tracking DB] Connecting... (attempt ${attempt}/${RETRY_ATTEMPTS})`);
      pool = await new sql.ConnectionPool(trackingConfig).connect();

      pool.on('error', (err) => {
        console.error('[Tracking DB] Pool error:', err.message);
      });

      console.log('[Tracking DB] Connected successfully.');
      return pool;
    } catch (err) {
      console.error(`[Tracking DB] Connection attempt ${attempt} failed: ${err.message}`);

      if (attempt < RETRY_ATTEMPTS) {
        console.log(`[Tracking DB] Retrying in ${RETRY_DELAY_MS / 1000}s...`);
        await delay(RETRY_DELAY_MS);
      } else {
        throw new Error(`[Tracking DB] All ${RETRY_ATTEMPTS} connection attempts failed. Last error: ${err.message}`);
      }
    }
  }
}

/**
 * Gracefully closes the Tracking connection pool.
 */
async function closePool() {
  if (pool) {
    await pool.close();
    pool = null;
    console.log('[Tracking DB] Pool closed.');
  }
}

/** @param {number} ms */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { getPool, closePool };
