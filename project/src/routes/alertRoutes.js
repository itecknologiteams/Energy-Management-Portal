'use strict';

/**
 * Alert routes — read-only view of alert settings and monitor health.
 * SMTP credentials and recipient addresses are never returned.
 */

const express = require('express');
const { getAlertConfig, getConfigStatus } = require('../config/alertConfig');
const temperatureMonitor = require('../services/temperatureMonitor');
const { noCache } = require('../middleware/validate');

const router = express.Router();

// GET /api/alerts/status — thresholds, monitor/email on-off, last run, config problems
router.get('/alerts/status', noCache, (_req, res) => {
  const cfg = getAlertConfig();
  const { path: configFile, errors, warnings } = getConfigStatus();
  res.json({
    success: true,
    configFile,
    configErrors: errors,
    configWarnings: warnings,
    temperature: {
      enabled: cfg.temperature.enabled,
      defaultThresholdC: cfg.temperature.defaultThresholdC,
      vehicleThresholdsC: cfg.temperature.vehicleThresholdsC,
      recoveryMarginC: cfg.temperature.recoveryMarginC,
    },
    monitor: { ...cfg.monitor, ...temperatureMonitor.getStatus() },
    email: {
      enabled: cfg.email.enabled,
      smtpHost: cfg.email.smtp.host || null,
      fleetsWithOwnRecipients: Object.keys(cfg.email.recipients.byFleet),
    },
  });
});

module.exports = router;
