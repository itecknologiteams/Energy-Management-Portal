'use strict';

/**
 * Fleet routes — defines API endpoints for fleet and vehicle operations.
 */

const express = require('express');
const fleetController = require('../controllers/fleetController');
const { validateFleetId, validateVehicleId, noCache } = require('../middleware/validate');

const router = express.Router();

// ─── Fleet Vehicle Endpoints ─────────────────────────────────────────────────

// GET /api/fleets/:fleetId/vehicles — list all vehicles in a fleet
router.get(
  '/fleets/:fleetId/vehicles',
  validateFleetId,
  fleetController.getFleetVehicles
);

// GET /api/fleets/:fleetId/vehicles-with-sensors — list vehicles with sensor mappings
router.get(
  '/fleets/:fleetId/vehicles-with-sensors',
  validateFleetId,
  fleetController.getFleetVehiclesWithSensors
);

// ─── Individual Vehicle Endpoints ────────────────────────────────────────────

// GET /api/vehicles/:vehicleId/sensors — get sensor configuration for a vehicle
router.get(
  '/vehicles/:vehicleId/sensors',
  validateVehicleId,
  fleetController.getVehicleSensors
);

// GET /api/vehicles/:vehicleId/analytics?date=YYYY-MM-DD — calculate vehicle analytics
router.get(
  '/vehicles/:vehicleId/analytics',
  noCache,
  validateVehicleId,
  fleetController.getVehicleAnalytics
);

// GET /api/vehicles/:vehicleId/fuel-debug?date=YYYY-MM-DD — debug fuel calculation
router.get(
  '/vehicles/:vehicleId/fuel-debug',
  noCache,
  validateVehicleId,
  fleetController.getVehicleFuelDebug
);

// GET /api/vehicles/:vehicleId/fuel-series?date=YYYY-MM-DD — fuel time-series for graphing
router.get(
  '/vehicles/:vehicleId/fuel-series',
  noCache,
  validateVehicleId,
  fleetController.getVehicleFuelSeries
);

// ─── Fleet Analytics Endpoints ───────────────────────────────────────────────

// GET /api/fleets/:fleetId/analytics?date=YYYY-MM-DD — calculate fleet analytics
router.get(
  '/fleets/:fleetId/analytics',
  noCache,
  validateFleetId,
  fleetController.getFleetAnalytics
);

// POST /api/vehicles/:vehicleId/fix-calibration — fix wrong calibration for Advog Vehra L/S
router.post(
  '/vehicles/:vehicleId/fix-calibration',
  noCache,
  validateVehicleId,
  fleetController.fixCalibration
);

// GET /api/vehicles/:vehicleId/raw-sensors — get raw sensor data directly from DB (no cache)
router.get(
  '/vehicles/:vehicleId/raw-sensors',
  noCache,
  validateVehicleId,
  fleetController.getRawSensors
);

// GET /api/fleets/:fleetId/battery-check?date=YYYY-MM-DD — raw battery fields for all vehicles
router.get(
  '/fleets/:fleetId/battery-check',
  noCache,
  validateFleetId,
  fleetController.getFleetBatteryCheck
);

module.exports = router;
