'use strict';

/**
 * Alert notifier — runs inside the API server and emails alert rule breaches,
 * whether or not anyone has the dashboard open.
 *
 * Every ALERT_EMAIL_INTERVAL_MS it checks each fleet that has enabled rules
 * with email recipients. A breach (rule + vehicle) is emailed once when it
 * starts; it is remembered in data/alert-email-state.json so a restart does
 * not resend it, and forgotten once it clears so a later breach mails again.
 * A failed send is not remembered, so it is retried on the next check.
 */

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const emailService = require('./emailService');
const alertService = require('./alertService');
const alertRuleRepository = require('../repositories/alertRuleRepository');

const INTERVAL_MS = parseInt(process.env.ALERT_EMAIL_INTERVAL_MS || '60000', 10);
const STATE_FILE = path.join(path.dirname(alertRuleRepository.RULES_FILE), 'alert-email-state.json');

let timer = null;
let running = false;

const breachKey = (a) => `${a.ruleId}:${a.vehicleId}`;

async function readState() {
  try {
    return JSON.parse(await fs.promises.readFile(STATE_FILE, 'utf8')) || {};
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

async function writeState(state) {
  await fs.promises.mkdir(path.dirname(STATE_FILE), { recursive: true });
  const tmp = `${STATE_FILE}.${process.pid}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify(state, null, 2), 'utf8');
  await fs.promises.rename(tmp, STATE_FILE);
}

// Tracking times are PKT wall-clock values read back as UTC
function formatTime(iso) {
  return `${new Date(iso).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'UTC',
  })} PKT`;
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

/**
 * One email for one rule's new breaches.
 */
function buildEmail(fleetId, rule, alerts) {
  const limit = `${rule.operator} ${rule.threshold} °C`;
  const first = alerts[0];
  const subject = alerts.length === 1
    ? `Temperature alert: ${first.vehicleName} at ${first.value.toFixed(1)} °C (${limit})`
    : `Temperature alert: ${alerts.length} generators ${limit}`;

  const lines = alerts.map((a) => `- ${a.vehicleName}: ${a.value.toFixed(1)} °C at ${formatTime(a.at)}`);
  const text = [
    `Temperature is ${limit} on fleet ${fleetId}:`,
    '',
    ...lines,
    '',
    'You receive this because your email is on this alert in the Energy Management Portal.',
    'You will not be emailed again until the temperature returns within the limit and crosses it again.',
  ].join('\n');

  const rows = alerts.map((a) => `
      <tr>
        <td style="padding:6px 12px;border-bottom:1px solid #eee">${escapeHtml(a.vehicleName)}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #eee;color:#dc2626;font-weight:600">${a.value.toFixed(1)} °C</td>
        <td style="padding:6px 12px;border-bottom:1px solid #eee;color:#555">${escapeHtml(formatTime(a.at))}</td>
      </tr>`).join('');
  const html = `
    <div style="font-family:Arial,sans-serif;font-size:14px;color:#222">
      <h2 style="color:#ea580c;margin:0 0 8px">Temperature alert</h2>
      <p style="margin:0 0 12px">Temperature is <strong>${escapeHtml(limit)}</strong> on fleet ${fleetId}:</p>
      <table style="border-collapse:collapse">
        <tr style="text-align:left;color:#666">
          <th style="padding:6px 12px">Generator</th><th style="padding:6px 12px">Temperature</th><th style="padding:6px 12px">Reading time</th>
        </tr>${rows}
      </table>
      <p style="color:#777;font-size:12px;margin-top:16px">
        You receive this because your email is on this alert in the Energy Management Portal.
        You will not be emailed again until the temperature returns within the limit and crosses it again.
      </p>
    </div>`;

  return { to: rule.emails, subject, text, html };
}

/**
 * One pass over every fleet with emailed rules. Never throws.
 */
async function checkAndNotify() {
  if (running) return; // a slow pass is still going; skip this tick
  running = true;
  try {
    const allRules = await alertRuleRepository.listAllRules();
    const state = await readState();
    const nextState = {};

    for (const [fleetKey, rules] of Object.entries(allRules)) {
      const emailRules = new Map(
        (rules || []).filter((r) => r.enabled && r.emails?.length).map((r) => [r.id, r])
      );
      if (emailRules.size === 0) continue;

      try {
        const fleetId = parseInt(fleetKey, 10);
        const { triggered } = await alertService.checkFleetAlerts(fleetId);
        const announced = new Set(state[fleetKey] || []);
        const stillActive = new Set();
        const fresh = new Map(); // rule → its new breaches

        for (const a of triggered) {
          const rule = emailRules.get(a.ruleId);
          if (!rule) continue;
          if (announced.has(breachKey(a))) {
            stillActive.add(breachKey(a));
          } else {
            fresh.set(rule, [...(fresh.get(rule) || []), a]);
          }
        }

        for (const [rule, alerts] of fresh) {
          try {
            await emailService.sendMail(buildEmail(fleetId, rule, alerts));
            alerts.forEach((a) => stillActive.add(breachKey(a)));
            logger.info(`[alertNotifier] Emailed ${rule.emails.length} recipient(s): fleet ${fleetId}, ${alerts.length} breach(es) of rule ${rule.id}`);
          } catch (err) {
            logger.error(`[alertNotifier] Email failed for fleet ${fleetId}, rule ${rule.id} (will retry): ${err.message}`);
          }
        }
        nextState[fleetKey] = [...stillActive];
      } catch (err) {
        // Keep what was announced, so a failed check does not cause resends
        nextState[fleetKey] = state[fleetKey] || [];
        logger.error(`[alertNotifier] Check failed for fleet ${fleetKey}: ${err.message}`);
      }
    }

    await writeState(nextState);
  } catch (err) {
    logger.error(`[alertNotifier] Pass failed: ${err.message}`);
  } finally {
    running = false;
  }
}

/**
 * Start the periodic checks. Does nothing when SMTP is not configured.
 */
function start() {
  if (timer) return;
  if (!emailService.isConfigured()) {
    logger.info('[alertNotifier] SMTP not configured — alert emails are off');
    return;
  }
  logger.info(`[alertNotifier] Alert emails on — checking every ${Math.round(INTERVAL_MS / 1000)} s`);
  timer = setInterval(checkAndNotify, INTERVAL_MS);
  checkAndNotify();
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = {
  start,
  stop,
  checkAndNotify,
  buildEmail,
};
