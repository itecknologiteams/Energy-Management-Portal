'use strict';

// Load environment variables first — before any other module reads process.env
// .env.local (untracked secrets such as SMTP_PASSWORD) is read first; dotenv
// never overrides a value already set, so it wins over .env.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });
require('dotenv').config();

const app = require('./app');
const logger = require('./utils/logger');
const alertNotifier = require('./services/alertNotifier');
const { getPool: getCrmPool, closePool: closeCrmPool } = require('./db/crmDb');
const { getPool: getTrackingPool, closePool: closeTrackingPool } = require('./db/trackingDb');

const PORT = process.env.PORT || 3010;

/**
 * Initialize database connections with clear error handling.
 * Exits process on failure to prevent running without DB access.
 */
async function initializeDatabases() {
  logger.info('Initializing database connections...');

  try {
    // Initialize CRM database pool
    logger.info('Connecting to CRM database...');
    await getCrmPool();
    logger.info('CRM database connected successfully');
  } catch (err) {
    logger.error('Failed to connect to CRM database:', err);
    logger.error(`CRM DB Host: ${process.env.CRM_DB_HOST || 'NOT SET'}`);
    logger.error('Please check:');
    logger.error('  1. CRM_DB_HOST, CRM_DB_USER, CRM_DB_PASSWORD, CRM_DB_NAME in .env');
    logger.error('  2. SQL Server is running and accessible');
    logger.error('  3. Network connectivity to the database host');
    throw new Error('CRM database connection failed');
  }

  try {
    // Initialize Tracking database pool
    logger.info('Connecting to Tracking database...');
    await getTrackingPool();
    logger.info('Tracking database connected successfully');
  } catch (err) {
    logger.error('Failed to connect to Tracking database:', err);
    logger.error(`Tracking DB Host: ${process.env.TRACKING_DB_HOST || 'NOT SET'}`);
    logger.error('Please check:');
    logger.error('  1. TRACKING_DB_HOST, TRACKING_DB_USER, TRACKING_DB_PASSWORD in .env');
    logger.error('  2. SQL Server is running and accessible');
    logger.error('  3. Network connectivity to the database host');
    throw new Error('Tracking database connection failed');
  }

  logger.info('All database connections established');
}

/**
 * Start the HTTP server after database initialization.
 */
async function startServer() {
  const server = app.listen(PORT, () => {
    logger.info(`Fleet Analytics API running on port ${PORT} (${process.env.NODE_ENV || 'development'})`);
    logger.info(`Health check available at: http://localhost:${PORT}/health`);
  });

  return server;
}

/**
 * Graceful shutdown handler.
 * Closes database pools before exiting.
 */
async function gracefulShutdown(server, signal) {
  logger.info(`${signal} received — starting graceful shutdown...`);
  alertNotifier.stop();

  // Close HTTP server first (stop accepting new connections)
  server.close(async () => {
    logger.info('HTTP server closed');

    // Close database pools
    try {
      await closeCrmPool();
      logger.info('CRM database pool closed');
    } catch (err) {
      logger.error('Error closing CRM pool:', err);
    }

    try {
      await closeTrackingPool();
      logger.info('Tracking database pool closed');
    } catch (err) {
      logger.error('Error closing Tracking pool:', err);
    }

    logger.info('Shutdown complete. Goodbye.');
    process.exit(0);
  });

  // Force exit after timeout if graceful shutdown hangs
  setTimeout(() => {
    logger.error('Forced exit after graceful shutdown timeout');
    process.exit(1);
  }, 10000);
}

/**
 * Main startup function.
 */
async function start() {
  try {
    // Initialize databases first
    await initializeDatabases();

    // Start HTTP server
    const server = await startServer();

    // Email alert rule breaches in the background (off without SMTP settings)
    alertNotifier.start();

    // Register shutdown handlers
    process.on('SIGTERM', () => gracefulShutdown(server, 'SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown(server, 'SIGINT'));

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled Rejection at:', promise);
      logger.error('Reason:', reason);

      // Graceful shutdown
      gracefulShutdown(server, 'UNHANDLED_REJECTION');
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', (err) => {
      logger.error('Uncaught Exception:', err);

      // Immediate exit for uncaught exceptions (process is in undefined state)
      process.exit(1);
    });
  } catch (err) {
    logger.error('Startup failed:', err.message);
    logger.error('Process will exit');
    process.exit(1);
  }
}

// Start the application
start();
