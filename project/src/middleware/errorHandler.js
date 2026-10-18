'use strict';

/**
 * Global error handling middleware.
 * Catches all errors and returns structured JSON responses.
 * Never leaks internal details like credentials or file paths in production.
 */

const { DEBUG_MODE } = require('../constants');
const {
  AppError,
  ValidationError,
  TrackingTableNotFoundError,
} = require('../utils/errors');

/**
 * Sanitize error message to remove sensitive information.
 * Removes file paths, connection strings, and internal details.
 *
 * @param {string} message
 * @returns {string}
 */
function sanitizeErrorMessage(message) {
  if (!message) return 'An error occurred';

  // Remove file paths (anything that looks like /path/to/file or C:\path)
  let sanitized = message.replace(/[\/\\][\w\-\.]+[\/\\][\w\-\.\/\\]+/g, '[path]');

  // Remove connection strings with passwords
  sanitized = sanitized.replace(/(password|pwd|secret|key)\s*[=:]\s*[^\s,;]+/gi, '$1=[redacted]');

  // Remove SQL Server connection details
  sanitized = sanitized.replace(/Server=[^;]+/gi, 'Server=[redacted]');
  sanitized = sanitized.replace(/Database=[^;]+/gi, 'Database=[redacted]');
  sanitized = sanitized.replace(/User\s*Id=[^;]+/gi, 'User Id=[redacted]');

  return sanitized;
}

/**
 * Global error handler middleware.
 * Must have 4 parameters for Express to recognize it as error handler.
 *
 * @param {Error} err
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} _next
 */
function errorHandler(err, req, res, _next) {
  // Determine if this is a known AppError with predefined response
  const isAppError = err instanceof AppError;

  // Get status code (default to 500)
  const statusCode = isAppError ? err.statusCode : (err.status || 500);

  // Get error code
  let errorCode = isAppError ? err.errorCode : 'INTERNAL_ERROR';

  // Get error message
  let message = err.message || 'Internal Server Error';

  // Special handling for specific error types
  if (err instanceof TrackingTableNotFoundError) {
    message = 'Tracking data not available for this date';
    errorCode = 'TRACKING_TABLE_NOT_FOUND';
  } else if (err instanceof ValidationError) {
    errorCode = 'VALIDATION_ERROR';
  }

  // Log error details internally (full details for debugging)
  const logPrefix = `[ErrorHandler] ${req.method} ${req.originalUrl} - ${statusCode}`;

  if (statusCode >= 500) {
    // Server errors - log full stack trace
    console.error(logPrefix);
    console.error('Error:', err);
    if (err.stack) {
      console.error('Stack:', err.stack);
    }
  } else {
    // Client errors - just log message
    console.error(`${logPrefix}: ${message}`);
  }

  // Build response object
  const response = {
    success: false,
    error: {
      code: errorCode,
      message: DEBUG_MODE ? message : sanitizeErrorMessage(message),
    },
  };

  // Add field information for validation errors
  if (err instanceof ValidationError && err.field) {
    response.error.field = err.field;
  }

  // Add extra context for tracking table errors
  if (err instanceof TrackingTableNotFoundError) {
    response.error.date = err.date;
  }

  // Include stack trace in debug mode only
  if (DEBUG_MODE && err.stack) {
    response.stack = err.stack;
  }

  res.status(statusCode).json(response);
}

module.exports = errorHandler;
