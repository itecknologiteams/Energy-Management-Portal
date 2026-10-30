'use strict';

/**
 * Alert controller — HTTP handlers for dashboard alert rules and alert checks.
 */

const alertService = require('../services/alertService');

/**
 * GET /api/fleets/:fleetId/alert-rules
 */
async function listRules(req, res, next) {
  try {
    const rules = await alertService.listRules(req.params.fleetId);
    res.json({ success: true, fleetId: req.params.fleetId, rules });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/fleets/:fleetId/alert-rules
 * Body: { vehicleId (null = all), metric, operator, threshold, enabled }
 */
async function createRule(req, res, next) {
  try {
    const rule = await alertService.createRule(req.params.fleetId, req.body);
    res.status(201).json({ success: true, rule });
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /api/fleets/:fleetId/alert-rules/:ruleId
 * Body: any of the createRule fields
 */
async function updateRule(req, res, next) {
  try {
    const rule = await alertService.updateRule(req.params.fleetId, req.params.ruleId, req.body);
    res.json({ success: true, rule });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/fleets/:fleetId/alert-rules/:ruleId
 */
async function deleteRule(req, res, next) {
  try {
    await alertService.deleteRule(req.params.fleetId, req.params.ruleId);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/fleets/:fleetId/alerts/check
 * Enabled rules that current readings break right now.
 */
async function checkAlerts(req, res, next) {
  try {
    const result = await alertService.checkFleetAlerts(req.params.fleetId);
    res.json({ success: true, fleetId: req.params.fleetId, ...result });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listRules,
  createRule,
  updateRule,
  deleteRule,
  checkAlerts,
};
