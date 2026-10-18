'use strict';

/**
 * Custom error classes for the Fleet Vehicle Analytics API.
 * Provides structured error handling with status codes and error codes for clients.
 */

/**
 * Base application error.
 * All custom errors extend this class.
 */
class AppError extends Error {
  /**
   * @param {string} message - Human-readable error message
   * @param {number} statusCode - HTTP status code
   * @param {string} errorCode - Machine-readable error code for client handling
   */
  constructor(message, statusCode = 500, errorCode = 'INTERNAL_ERROR') {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.isOperational = true; // Distinguishes operational errors from programmer errors

    // Capture stack trace (exclude constructor call from stack)
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Serialize error for API response.
   * @returns {Object} JSON-serializable error object
   */
  toJSON() {
    return {
      success: false,
      error: this.message,
      errorCode: this.errorCode,
      statusCode: this.statusCode,
    };
  }
}

/**
 * Validation error — invalid input from client.
 * HTTP 400 Bad Request
 */
class ValidationError extends AppError {
  /**
   * @param {string} message
   * @param {string} field - Optional field name that failed validation
   */
  constructor(message, field = null) {
    super(message, 400, 'VALIDATION_ERROR');
    this.field = field;
  }

  toJSON() {
    return {
      ...super.toJSON(),
      field: this.field,
    };
  }
}

/**
 * Not Found error — requested resource does not exist.
 * HTTP 404 Not Found
 */
class NotFoundError extends AppError {
  /**
   * @param {string} resource - Type of resource (e.g., 'fleet', 'vehicle')
   * @param {string|number} identifier - ID that was not found
   */
  constructor(resource, identifier) {
    super(
      `${resource} not found: ${identifier}`,
      404,
      'NOT_FOUND'
    );
    this.resource = resource;
    this.identifier = identifier;
  }

  toJSON() {
    return {
      ...super.toJSON(),
      resource: this.resource,
      identifier: this.identifier,
    };
  }
}

/**
 * Tracking Table Not Found error — the daily tracking table doesn't exist.
 * HTTP 404 Not Found
 */
class TrackingTableNotFoundError extends AppError {
  /**
   * @param {string} tableName - The tracking table name that doesn't exist
   * @param {string} date - The date string that was requested
   */
  constructor(tableName, date) {
    super(
      `Tracking data not available for date: ${date}`,
      404,
      'TRACKING_TABLE_NOT_FOUND'
    );
    this.tableName = tableName;
    this.date = date;
  }

  toJSON() {
    return {
      ...super.toJSON(),
      tableName: this.tableName,
      date: this.date,
    };
  }
}

/**
 * Database error — something went wrong with the database connection or query.
 * HTTP 500 Internal Server Error (or 503 Service Unavailable for connection issues)
 */
class DatabaseError extends AppError {
  /**
   * @param {string} message
   * @param {Error} originalError - The original error from the database driver
   * @param {boolean} isConnectionError - Whether this was a connection failure
   */
  constructor(message, originalError = null, isConnectionError = false) {
    super(
      message,
      isConnectionError ? 503 : 500,
      isConnectionError ? 'DATABASE_CONNECTION_ERROR' : 'DATABASE_ERROR'
    );
    this.originalError = originalError;
    this.isConnectionError = isConnectionError;
  }

  toJSON() {
    const json = super.toJSON();
    // Only include original error details in non-production environments
    if (process.env.NODE_ENV !== 'production' && this.originalError) {
      json.originalError = this.originalError.message;
    }
    return json;
  }
}

module.exports = {
  AppError,
  ValidationError,
  NotFoundError,
  TrackingTableNotFoundError,
  DatabaseError,
};
