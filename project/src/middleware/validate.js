'use strict';

/**
 * Validation middleware — validates route parameters before controller execution.
 */

/**
 * Validate that fleetId parameter is a positive integer.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function validateFleetId(req, res, next) {
  const { fleetId } = req.params;
  const parsed = parseInt(fleetId, 10);

  if (Number.isNaN(parsed) || parsed <= 0) {
    return res.status(400).json({
      success: false,
      error: 'Invalid fleetId. Must be a positive integer.',
      field: 'fleetId',
      received: fleetId,
    });
  }

  // Store parsed value for downstream use
  req.params.fleetId = parsed;
  next();
}

/**
 * Validate that vehicleId parameter is a positive integer.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function validateVehicleId(req, res, next) {
  const { vehicleId } = req.params;
  const parsed = parseInt(vehicleId, 10);

  if (Number.isNaN(parsed) || parsed <= 0) {
    return res.status(400).json({
      success: false,
      error: 'Invalid vehicleId. Must be a positive integer.',
      field: 'vehicleId',
      received: vehicleId,
    });
  }

  req.params.vehicleId = parsed;
  next();
}

/**
 * Validate date parameter in YYYY-MM-DD format.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function validateDate(req, res, next) {
  const { date } = req.params;

  // YYYY-MM-DD regex pattern
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

  if (!date || !dateRegex.test(date)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid date format. Must be YYYY-MM-DD.',
      field: 'date',
      received: date,
    });
  }

  // Validate it's actually a real date
  const parsedDate = new Date(date);
  if (Number.isNaN(parsedDate.getTime())) {
    return res.status(400).json({
      success: false,
      error: 'Invalid date value. Must be a valid calendar date.',
      field: 'date',
      received: date,
    });
  }

  // Store parsed date for downstream use
  req.params.parsedDate = parsedDate;
  next();
}

/**
 * Validate date range (startDate and endDate query parameters).
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function validateDateRange(req, res, next) {
  const { startDate, endDate } = req.query;
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

  // Validate startDate if provided
  if (startDate) {
    if (!dateRegex.test(startDate)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid startDate format. Must be YYYY-MM-DD.',
        field: 'startDate',
        received: startDate,
      });
    }

    const parsedStart = new Date(startDate);
    if (Number.isNaN(parsedStart.getTime())) {
      return res.status(400).json({
        success: false,
        error: 'Invalid startDate value. Must be a valid calendar date.',
        field: 'startDate',
        received: startDate,
      });
    }

    req.query.parsedStartDate = parsedStart;
  }

  // Validate endDate if provided
  if (endDate) {
    if (!dateRegex.test(endDate)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid endDate format. Must be YYYY-MM-DD.',
        field: 'endDate',
        received: endDate,
      });
    }

    const parsedEnd = new Date(endDate);
    if (Number.isNaN(parsedEnd.getTime())) {
      return res.status(400).json({
        success: false,
        error: 'Invalid endDate value. Must be a valid calendar date.',
        field: 'endDate',
        received: endDate,
      });
    }

    req.query.parsedEndDate = parsedEnd;
  }

  // Validate range if both dates provided
  if (req.query.parsedStartDate && req.query.parsedEndDate) {
    if (req.query.parsedStartDate > req.query.parsedEndDate) {
      return res.status(400).json({
        success: false,
        error: 'startDate must be before or equal to endDate.',
        field: 'dateRange',
      });
    }
  }

  next();
}

/**
 * Middleware to disable caching for dynamic data endpoints.
 * Prevents HTTP 304 (Not Modified) responses that can cause stale data.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function noCache(req, res, next) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.set('ETag', ''); // Remove ETag to prevent conditional requests
  next();
}

module.exports = {
  validateFleetId,
  validateVehicleId,
  validateDate,
  validateDateRange,
  noCache,
};
