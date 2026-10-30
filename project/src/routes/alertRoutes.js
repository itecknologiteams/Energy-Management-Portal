'use strict';

/**
 * Public alert health check. Shows only on/off flags and counts — no fleet IDs,
 * vehicle IDs, limits or addresses. Full details are in the admin portal
 * (GET /api/admin/overview).
 */

const express = require('express');
const { getAlertConfig, getConfigStatus } = require('../config/alertConfig');
const { monitoredFleetIds } = require('../services/fleetAlertSettings');
const temperatureMonitor = require('../services/temperatureMonitor');
const { noCache } = require('../middleware/validate');

const router = express.Router();

// GET /api/alerts/status
router.get('/alerts/status', noCache, (_req, res) => {
  const cfg = getAlertConfig();
  const { errors } = getConfigStatus();
  const lastRun = temperatureMonitor.getStatus().lastRun;
  res.json({
    success: true,
    temperatureAlertsEnabled: cfg.temperature.enabled,
    monitorEnabled: cfg.monitor.enabled,
    emailEnabled: cfg.email.enabled,
    monitoredFleetCount: monitoredFleetIds(cfg).length,
    configErrorCount: errors.length,
    lastRun: lastRun ? {
      finishedAt: lastRun.finishedAt,
      generatorsChecked: lastRun.checked,
      emailsSent: lastRun.emailsSent,
      errorCount: lastRun.errors.length,
    } : null,
  });
});

module.exports = router;
