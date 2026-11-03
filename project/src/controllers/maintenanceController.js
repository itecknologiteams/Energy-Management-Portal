'use strict';

/**
 * Maintenance controller — HTTP handlers for generator service settings
 * and status.
 */

const maintenanceService = require('../services/maintenanceService');

/**
 * GET /api/fleets/:fleetId/vehicles/:vehicleId/maintenance
 */
async function getMaintenance(req, res, next) {
  try {
    const result = await maintenanceService.getMaintenance(req.params.fleetId, req.params.vehicleId);
    res.json({ success: true, vehicleId: req.params.vehicleId, ...result });
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /api/fleets/:fleetId/vehicles/:vehicleId/maintenance
 * Body: { model, lastServiceDate, hourMeterAtLastService, serviceIntervalHours, serviceIntervalDays }
 */
async function saveMaintenance(req, res, next) {
  try {
    const result = await maintenanceService.saveMaintenance(req.params.fleetId, req.params.vehicleId, req.body);
    res.json({ success: true, vehicleId: req.params.vehicleId, ...result });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getMaintenance,
  saveMaintenance,
};
