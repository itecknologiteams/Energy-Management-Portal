'use strict';

/**
 * Checks config/alerts.json and sends a sample temperature alert email.
 * Does not touch the databases.
 *
 *   npm run alerts:test-email                 → default recipients
 *   npm run alerts:test-email -- 1735         → recipients for fleet 1735
 *   npm run alerts:test-email -- --verify     → only test the SMTP login
 */

require('dotenv').config();

const { getAlertConfig, getConfigStatus, getRecipientsForFleet } = require('../src/config/alertConfig');
const { sendMail, verifyConnection } = require('../src/services/mailService');
const { buildTemperatureEmail } = require('../src/services/temperatureMonitor');

async function main() {
  const args = process.argv.slice(2);
  const verifyOnly = args.includes('--verify');
  const fleetArg = args.find((a) => /^\d+$/.test(a));

  const cfg = getAlertConfig();
  const status = getConfigStatus();
  console.log(`Config file: ${status.path}`);
  status.warnings.forEach((w) => console.log(`  warning: ${w}`));
  status.errors.forEach((e) => console.log(`  error:   ${e}`));

  if (!cfg.email.enabled) {
    console.error('\nEmail is disabled (email.enabled is false, or the settings above have errors).');
    process.exit(1);
  }

  console.log(`\nConnecting to ${cfg.email.smtp.host}:${cfg.email.smtp.port} (secure=${cfg.email.smtp.secure}) ...`);
  await verifyConnection(cfg);
  console.log('SMTP connection and login OK.');
  if (verifyOnly) return;

  const fleetId = fleetArg ? parseInt(fleetArg, 10) : (cfg.monitor.fleetIds[0] || 0);
  const recipients = fleetArg ? getRecipientsForFleet(fleetId, cfg) : cfg.email.recipients.default;
  const threshold = cfg.temperature.defaultThresholdC;
  const email = buildTemperatureEmail(fleetId, [{
    kind: 'alert', vehicleId: 0, vehicleName: 'TEST GENERATOR (sample)',
    celsius: threshold + 5, threshold, at: new Date().toISOString(), since: null,
  }], { ...cfg, dbTimestampsAreLocalTime: false });

  const info = await sendMail({
    ...email,
    subject: `${email.subject} — TEST, please ignore`,
    to: recipients.to,
    cc: recipients.cc,
  }, cfg);
  console.log(`Test email sent to ${recipients.to.join(', ')}${recipients.cc.length ? ` (cc ${recipients.cc.join(', ')})` : ''}.`);
  console.log(`Message ID: ${info.messageId}`);
  if (info.rejected.length) console.log(`Rejected: ${info.rejected.join(', ')}`);
}

main().catch((err) => {
  console.error(`\nFailed: ${err.message}`);
  process.exit(1);
});
