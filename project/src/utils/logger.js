'use strict';

/**
 * Simple logger utility.
 * Provides timestamped logging with different levels.
 */

const { DEBUG_MODE } = require('../constants');

/**
 * Get current timestamp in ISO format
 * @returns {string}
 */
function getTimestamp() {
  return new Date().toISOString();
}

/**
 * Format log message with timestamp and level
 * @param {string} level
 * @param {string} message
 * @returns {string}
 */
function formatMessage(level, message) {
  return `[${getTimestamp()}] [${level}] ${message}`;
}

/**
 * Log info level message
 * @param {string} message
 */
function info(message) {
  console.log(formatMessage('INFO', message));
}

/**
 * Log warn level message
 * @param {string} message
 */
function warn(message) {
  console.warn(formatMessage('WARN', message));
}

/**
 * Log error level message.
 * If an Error object is passed, includes the stack trace.
 *
 * @param {string|Error} message - Error message or Error object
 * @param {Error} [error] - Optional Error object for stack trace
 */
function error(message, error = null) {
  const err = error || (message instanceof Error ? message : null);
  const msg = message instanceof Error ? message.message : message;

  console.error(formatMessage('ERROR', msg));

  // Log stack trace if available and in debug mode
  if (err && err.stack && DEBUG_MODE) {
    console.error(formatMessage('STACK', err.stack));
  }
}

/**
 * Log debug level message (only in DEBUG_MODE)
 * @param {string} message
 */
function debug(message) {
  if (DEBUG_MODE) {
    console.log(formatMessage('DEBUG', message));
  }
}

module.exports = {
  info,
  warn,
  error,
  debug,
};
