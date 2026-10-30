'use strict';

/**
 * Alert routes — dashboard-configured alert rules and the check the
 * dashboard polls.
 */

const express = require('express');
const alertController = require('../controllers/alertController');
const { validateFleetId, noCache } = require('../middleware/validate');

const router = express.Router();

// GET /api/fleets/:fleetId/alert-rules — list the fleet's alert rules
router.get('/fleets/:fleetId/alert-rules', validateFleetId, noCache, alertController.listRules);

// POST /api/fleets/:fleetId/alert-rules — add a rule
router.post('/fleets/:fleetId/alert-rules', validateFleetId, alertController.createRule);

// PUT /api/fleets/:fleetId/alert-rules/:ruleId — change a rule (e.g. enable/disable)
router.put('/fleets/:fleetId/alert-rules/:ruleId', validateFleetId, alertController.updateRule);

// DELETE /api/fleets/:fleetId/alert-rules/:ruleId — remove a rule
router.delete('/fleets/:fleetId/alert-rules/:ruleId', validateFleetId, alertController.deleteRule);

// GET /api/fleets/:fleetId/alerts/check — rules broken by current readings
router.get('/fleets/:fleetId/alerts/check', validateFleetId, noCache, alertController.checkAlerts);

module.exports = router;
