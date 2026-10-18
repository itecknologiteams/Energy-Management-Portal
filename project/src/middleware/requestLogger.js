'use strict';

/**
 * Request logging middleware.
 * Logs every request with timestamp, method, path, status code, and duration.
 */

/**
 * Format timestamp as YYYY-MM-DD HH:MM:SS
 * @returns {string}
 */
function formatTimestamp() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * Request logger middleware.
 * Attaches to response finish event to capture status code and duration.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function requestLogger(req, res, next) {
  const startTime = Date.now();
  const timestamp = formatTimestamp();

  // Hook into response finish event
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const statusCode = res.statusCode;

    // Format: [2026-04-15 14:32:01] GET /api/fleets/1735/vehicles 200 45ms
    console.log(`[${timestamp}] ${req.method} ${req.originalUrl} ${statusCode} ${duration}ms`);
  });

  next();
}

module.exports = requestLogger;
