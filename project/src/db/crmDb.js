'use strict';

const sql = require('mssql');
const { crmConfig } = require('../config/dbConfig');

const RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 3_000;

let pool = null;

/**
 * Returns the existing CRM connection pool, creating it on first call.
 * Retries up to RETRY_ATTEMPTS times with a delay on failure.
 *
 * @returns {Promise<sql.ConnectionPool>}
 */
async function getPool() {
  if (pool && pool.connected) return pool;

  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      console.log(`[CRM DB] Connecting... (attempt ${attempt}/${RETRY_ATTEMPTS})`);
      pool = await new sql.ConnectionPool(crmConfig).connect();

      pool.on('error', (err) => {
        console.error('[CRM DB] Pool error:', err.message);
      });

      console.log('[CRM DB] Connected successfully.');
      return pool;
    } catch (err) {
      console.error(`[CRM DB] Connection attempt ${attempt} failed: ${err.message}`);

      if (attempt < RETRY_ATTEMPTS) {
        console.log(`[CRM DB] Retrying in ${RETRY_DELAY_MS / 1000}s...`);
        await delay(RETRY_DELAY_MS);
      } else {
        throw new Error(`[CRM DB] All ${RETRY_ATTEMPTS} connection attempts failed. Last error: ${err.message}`);
      }
    }
  }
}

/**
 * Gracefully closes the CRM connection pool.
 */
async function closePool() {
  if (pool) {
    await pool.close();
    pool = null;
    console.log('[CRM DB] Pool closed.');
  }
}

/** @param {number} ms */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { getPool, closePool };
