'use strict';

/**
 * Database configuration objects built exclusively from environment variables.
 * dotenv must be initialised before this module is imported (done in server.js).
 */

const crmConfig = {
  server: process.env.CRM_DB_HOST,
  user: process.env.CRM_DB_USER,
  password: process.env.CRM_DB_PASSWORD,
  database: process.env.CRM_DB_NAME,
  options: {
    encrypt: false,           // set true if using Azure / TLS
    trustServerCertificate: true,
    enableArithAbort: true,
  },
  pool: {
    max: 10,
    min: 2,
    idleTimeoutMillis: 30_000,
  },
  connectionTimeout: 30_000,  // ms to wait for a new connection
  requestTimeout: 60_000,     // ms to wait for a query result
};

const trackingConfig = {
  server: process.env.TRACKING_DB_HOST,
  user: process.env.TRACKING_DB_USER,
  password: process.env.TRACKING_DB_PASSWORD,
  database: process.env.TRACKING_DB_NAME || undefined, // may be blank until Part 2
  options: {
    encrypt: false,
    trustServerCertificate: true,
    enableArithAbort: true,
  },
  pool: {
    max: 10,
    min: 2,
    idleTimeoutMillis: 30_000,
  },
  connectionTimeout: 30_000,
  requestTimeout: 60_000,
};

module.exports = { crmConfig, trackingConfig };
