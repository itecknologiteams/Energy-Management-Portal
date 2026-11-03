'use strict';

/**
 * Maintenance routes — generator service settings and status for the
 * dashboard's Maintenance tab.
 */

const express = require('express');
const maintenanceController = require('../controllers/maintenanceController');
const { validateFleetId, validateVehicleId, noCache } = require('../middleware/validate');

const router = express.Router();

// GET /api/fleets/:fleetId/vehicles/:vehicleId/maintenance — settings + service status
router.get(
  '/fleets/:fleetId/vehicles/:vehicleId/maintenance',
  validateFleetId,
  validateVehicleId,
  noCache,
  maintenanceController.getMaintenance
);

// PUT /api/fleets/:fleetId/vehicles/:vehicleId/maintenance — save settings
router.put(
  '/fleets/:fleetId/vehicles/:vehicleId/maintenance',
  validateFleetId,
  validateVehicleId,
  maintenanceController.saveMaintenance
);

module.exports = router;
