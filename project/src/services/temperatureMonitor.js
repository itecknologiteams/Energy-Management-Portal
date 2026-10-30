'use strict';

/**
 * Temperature monitor — background job that checks every generator's latest
 * temperature reading against its threshold and emails the configured
 * recipients when a generator overheats, keeps overheating, or recovers.
 *
 * Runs inside the backend process (started from server.js). Settings come from
 * config/alerts.json and are re-read every cycle, so changing the interval,
 * thresholds, fleets or recipients needs no restart.
 *
 * Alert state is saved to data/alert-state.json so a restart does not resend
 * alerts that were already emailed.
 */

const fs = require('fs');
const path = require('path');

const { getAlertConfig } = require('../config/alertConfig');
const { resolveThreshold, resolveRecipients, monitoredFleetIds } = require('./fleetAlertSettings');
const alertHistory = require('./alertHistory');
const { getVehiclesByFleetId } = require('../repositories/fleetRepository');
const { getTrackingData } = require('../repositories/trackingRepository');
const { TrackingTableNotFoundError } = require('../utils/errors');
const { getLatestTemperatureReading } = require('./analyticsService');
const { dbClockNow, localDateString, formatReadingTime } = require('./alertService');
const mailService = require('./mailService');

const STATE_PATH = process.env.ALERT_STATE_PATH ||
  path.join(__dirname, '..', '..', 'data', 'alert-state.json');
const VEHICLE_CONCURRENCY = 5;

let timer = null;
let running = false;
let stopped = true;
let lastRun = null; // { startedAt, finishedAt, checked, alerts, emailsSent, errors[] }

// ═══════════════════════════════════════════════════════════════════════════════
// STATE MACHINE (pure)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Decide what to do with one vehicle's latest reading.
 *
 * States: normal → (above threshold) → active → (at/below threshold − margin) → normal.
 * The margin stops a reading hovering around the limit from flapping.
 *
 * @param {Object|undefined} prev - previous state for this vehicle
 * @param {{celsius:number, at:string}|null} reading - null when missing or stale
 * @param {number} threshold - °C
 * @param {{recoveryMarginC:number, repeatEmailEveryMinutes:number, sendRecoveryEmail:boolean}} rules
 * @param {number} nowMs - real time (ms) used for repeat timing
 * @returns {{ state:Object, notify:'alert'|'repeat'|'recovered'|null }}
 */
function decide(prev, reading, threshold, rules, nowMs) {
  const state = { active: false, since: null, lastEmailAt: null, ...(prev || {}) };

  // No fresh reading: hold the current state, send nothing.
  if (!reading) return { state, notify: null };

  state.lastValue = reading.celsius;
  state.lastReadingAt = reading.at;
  state.threshold = threshold;

  if (reading.celsius > threshold) {
    if (!state.active) {
      return { state: { ...state, active: true, since: reading.at, lastEmailAt: null }, notify: 'alert' };
    }
    if (!state.lastEmailAt) return { state, notify: 'alert' }; // earlier send failed / email was off
    const repeatMs = rules.repeatEmailEveryMinutes * 60000;
    if (repeatMs > 0 && nowMs - state.lastEmailAt >= repeatMs) return { state, notify: 'repeat' };
    return { state, notify: null };
  }

  if (state.active && reading.celsius <= threshold - rules.recoveryMarginC) {
    const wasEmailed = !!state.lastEmailAt;
    return {
      state: { ...state, active: false, since: null, lastEmailAt: null },
      notify: rules.sendRecoveryEmail && wasEmailed ? 'recovered' : null,
    };
  }

  return { state, notify: null };
}

/** The decide() rules, gathered from their sections of the config. */
function rulesFromConfig(cfg) {
  return {
    recoveryMarginC: cfg.temperature.recoveryMarginC,
    repeatEmailEveryMinutes: cfg.monitor.repeatEmailEveryMinutes,
    sendRecoveryEmail: cfg.monitor.sendRecoveryEmail,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// EMAIL CONTENT (pure)
// ═══════════════════════════════════════════════════════════════════════════════

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Build one email for a fleet covering every vehicle that needs notifying
 * in this cycle.
 *
 * @param {number} fleetId
 * @param {Array<{kind:string, vehicleId:number, vehicleName:string, celsius:number, threshold:number, at:string, since:string|null}>} items
 * @param {Object} cfg
 * @returns {{subject:string, text:string, html:string}}
 */
function buildTemperatureEmail(fleetId, items, cfg) {
  const overheating = items.filter((i) => i.kind !== 'recovered');
  const recovered = items.filter((i) => i.kind === 'recovered');
  const prefix = cfg.email.subjectPrefix ? `${cfg.email.subjectPrefix} ` : '';

  let subject;
  if (overheating.length === 1) {
    const i = overheating[0];
    subject = `${prefix}High temperature: ${i.vehicleName} ${i.celsius} °C (limit ${i.threshold} °C)`;
  } else if (overheating.length > 0) {
    subject = `${prefix}High temperature on ${overheating.length} generator${overheating.length > 1 ? 's' : ''}`;
  } else if (recovered.length === 1) {
    subject = `${prefix}Temperature back to normal: ${recovered[0].vehicleName}`;
  } else {
    subject = `${prefix}Temperature back to normal on ${recovered.length} generators`;
  }

  const time = (at) => (at ? formatReadingTime(at, cfg) : '—');
  const label = (kind) => (kind === 'repeat' ? 'Still above limit' : kind === 'recovered' ? 'Back to normal' : 'Above limit');

  const textLines = [`Fleet ${fleetId} — generator temperature alerts`, ''];
  for (const i of [...overheating, ...recovered]) {
    textLines.push(
      `${label(i.kind)}: ${i.vehicleName} (ID ${i.vehicleId})`,
      `  Temperature: ${i.celsius} °C   Limit: ${i.threshold} °C`,
      `  Reading time: ${time(i.at)}${i.since && i.kind !== 'recovered' ? `   Above limit since: ${time(i.since)}` : ''}`,
      ''
    );
  }
  textLines.push('This message was sent automatically by the Energy Management Portal.');

  const rows = [...overheating, ...recovered].map((i) => {
    const color = i.kind === 'recovered' ? '#15803d' : '#b91c1c';
    return `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${escapeHtml(i.vehicleName)}<br><span style="color:#6b7280;font-size:12px;">ID ${escapeHtml(i.vehicleId)}</span></td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:${color};font-weight:600;">${escapeHtml(label(i.kind))}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-weight:600;">${escapeHtml(i.celsius)} °C</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${escapeHtml(i.threshold)} °C</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${escapeHtml(time(i.at))}</td>
    </tr>`;
  }).join('');

  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f5f3ef;font-family:Segoe UI,Arial,sans-serif;color:#1f2937;">
  <div style="max-width:680px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
    <div style="background:#ea580c;color:#ffffff;padding:16px 20px;">
      <div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;opacity:.85;">Energy Management Portal</div>
      <div style="font-size:18px;font-weight:600;margin-top:4px;">Generator temperature alert — Fleet ${escapeHtml(fleetId)}</div>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <thead><tr style="background:#f9fafb;text-align:left;color:#4b5563;">
        <th style="padding:8px 12px;">Generator</th><th style="padding:8px 12px;">Status</th>
        <th style="padding:8px 12px;">Temperature</th><th style="padding:8px 12px;">Limit</th>
        <th style="padding:8px 12px;">Reading time</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div style="padding:14px 20px;color:#6b7280;font-size:12px;">This message was sent automatically by the Energy Management Portal.</div>
  </div>
</body></html>`;

  return { subject, text: textLines.join('\n'), html };
}

// ═══════════════════════════════════════════════════════════════════════════════
// STATE PERSISTENCE
// ═══════════════════════════════════════════════════════════════════════════════

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveState(state) {
  try {
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    const tmp = `${STATE_PATH}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, STATE_PATH);
  } catch (err) {
    console.error(`[temperatureMonitor] Could not save ${STATE_PATH}: ${err.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CYCLE
// ═══════════════════════════════════════════════════════════════════════════════

/** Map over items with at most `limit` in flight. */
async function mapLimited(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Latest fresh reading for a vehicle today, or null.
 * Readings older than monitor.maxReadingAgeMinutes are ignored so a device
 * that went silent while hot doesn't keep generating emails.
 */
async function readLatestTemperature(vehicleId, cfg) {
  let rows;
  try {
    rows = await getTrackingData(vehicleId, localDateString(cfg));
  } catch (err) {
    if (err instanceof TrackingTableNotFoundError) return null; // today's table not created yet
    throw err;
  }
  const reading = getLatestTemperatureReading(rows);
  if (!reading) return null;

  const ageMs = dbClockNow(cfg).getTime() - new Date(reading.at).getTime();
  if (ageMs > cfg.monitor.maxReadingAgeMinutes * 60000) return null;
  return reading;
}

/**
 * Run one check across all configured fleets.
 * @returns {Promise<Object>} summary of the run
 */
async function runOnce() {
  if (running) return lastRun;
  running = true;

  const cfg = getAlertConfig();
  const summary = { startedAt: new Date().toISOString(), finishedAt: null, checked: 0, alerts: 0, emailsSent: 0, errors: [] };
  const state = loadState();
  const rules = rulesFromConfig(cfg);

  try {
    if (!cfg.temperature.enabled) return summary;

    // Fleets switched on in the admin portal (+ any listed only in alerts.json)
    for (const fleetId of monitoredFleetIds(cfg)) {
      let vehicles;
      try {
        vehicles = await getVehiclesByFleetId(fleetId);
      } catch (err) {
        summary.errors.push(`fleet ${fleetId}: ${err.message}`);
        continue;
      }

      const pending = []; // notifications for this fleet
      const updates = await mapLimited(vehicles, VEHICLE_CONCURRENCY, async ({ vehicleId, vehicleName }) => {
        const id = parseInt(vehicleId, 10);
        const key = `${fleetId}:${id}`;
        try {
          const reading = await readLatestTemperature(id, cfg);
          const threshold = resolveThreshold(id, fleetId, cfg);
          const wasActive = !!state[key]?.active;
          const { state: next, notify } = decide(state[key], reading, threshold, rules, Date.now());
          summary.checked++;
          if (next.active) summary.alerts++;
          // With email off, an ongoing alert would re-fire every cycle; report transitions only
          const quiet = !cfg.email.enabled && notify === 'alert' && wasActive;
          if (notify && !quiet) {
            pending.push({
              key, kind: notify, vehicleId: id, vehicleName: vehicleName || `Generator ${id}`,
              celsius: next.lastValue, threshold, at: next.lastReadingAt, since: next.since,
            });
          }
          return { key, next };
        } catch (err) {
          summary.errors.push(`vehicle ${id}: ${err.message}`);
          return null;
        }
      });

      for (const u of updates) if (u) state[u.key] = u.next;

      if (pending.length === 0) continue;

      for (const p of pending) {
        console.warn(`[temperatureMonitor] ${p.kind.toUpperCase()} fleet=${fleetId} vehicle=${p.vehicleId} (${p.vehicleName}) ${p.celsius} °C, limit ${p.threshold} °C`);
      }

      if (!cfg.email.enabled) continue; // logged only; lastEmailAt stays empty

      // Only this fleet's own recipients — never another fleet's or a shared list
      const recipients = resolveRecipients(fleetId, cfg);
      const total = recipients.to.length + recipients.cc.length + recipients.bcc.length;
      if (total === 0) {
        summary.errors.push(`fleet ${fleetId}: no email recipients configured`);
        continue;
      }

      const email = buildTemperatureEmail(fleetId, pending, cfg);
      const record = { fleetId, subject: email.subject, to: recipients.to, cc: recipients.cc, bcc: recipients.bcc, items: pending };
      try {
        const info = await mailService.sendMail({ ...email, to: recipients.to, cc: recipients.cc, bcc: recipients.bcc }, cfg);
        summary.emailsSent++;
        const sentAt = Date.now();
        for (const p of pending) {
          if (p.kind !== 'recovered' && state[p.key]) state[p.key].lastEmailAt = sentAt;
        }
        alertHistory.recordEmail({ ...record, status: 'sent', messageId: info.messageId });
        console.log(`[temperatureMonitor] Email sent for fleet ${fleetId} to ${total} recipient(s) (${pending.length} item(s))`);
      } catch (err) {
        // lastEmailAt stays unset, so the alert is retried next cycle
        alertHistory.recordEmail({ ...record, status: 'failed', error: err.message });
        summary.errors.push(`fleet ${fleetId}: email failed: ${err.message}`);
        console.error(`[temperatureMonitor] Email failed for fleet ${fleetId}: ${err.message}`);
      }
    }

    saveState(state);
  } catch (err) {
    summary.errors.push(err.message);
    console.error('[temperatureMonitor] Cycle failed:', err.message);
  } finally {
    summary.finishedAt = new Date().toISOString();
    lastRun = summary;
    running = false;
  }
  return summary;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCHEDULING
// ═══════════════════════════════════════════════════════════════════════════════

function scheduleNext() {
  if (stopped) return;
  const cfg = getAlertConfig();
  // Re-check settings every minute while disabled so enabling it needs no restart
  const minutes = cfg.monitor.enabled ? cfg.monitor.intervalMinutes : 1;
  timer = setTimeout(tick, minutes * 60000);
  if (typeof timer.unref === 'function') timer.unref();
}

async function tick() {
  if (getAlertConfig().monitor.enabled) {
    const s = await runOnce();
    if (s && s.errors.length > 0) {
      console.warn(`[temperatureMonitor] Cycle finished with ${s.errors.length} error(s): ${s.errors.slice(0, 5).join(' | ')}`);
    }
  }
  scheduleNext();
}

/** Start the background loop (first check ~30 s after startup). */
function start() {
  if (!stopped) return;
  stopped = false;
  const cfg = getAlertConfig();
  console.log(
    `[temperatureMonitor] Started — monitor ${cfg.monitor.enabled ? `on, every ${cfg.monitor.intervalMinutes} min, fleets ${monitoredFleetIds(cfg).join(', ') || 'none yet (add them in /admin)'}` : 'off'}; ` +
    `email ${cfg.email.enabled ? 'on' : 'off'}; default limit ${cfg.temperature.defaultThresholdC} °C`
  );
  timer = setTimeout(tick, 30000);
  if (typeof timer.unref === 'function') timer.unref();
}

function stop() {
  stopped = true;
  if (timer) clearTimeout(timer);
  timer = null;
}

function getStatus() {
  return { running, stopped, lastRun };
}

module.exports = {
  start,
  stop,
  runOnce,
  getStatus,
  // exported for tests
  decide,
  rulesFromConfig,
  buildTemperatureEmail,
  escapeHtml,
};
