'use strict';

/**
 * Alert email history and admin audit log.
 *
 *   data/alert-history.jsonl — one line per email attempt (sent or failed)
 *   data/admin-audit.jsonl   — one line per admin action (login, settings change, test email)
 *
 * Both files are capped so they never grow without limit.
 */

const path = require('path');
const crypto = require('crypto');
const { appendJsonLine, readJsonLines, trimJsonLines } = require('../utils/jsonStore');

const MAX_HISTORY_ENTRIES = 20000;
const MAX_AUDIT_ENTRIES = 20000;
const TRIM_EVERY = 200; // writes between trims

const dataDir = () => process.env.ALERT_DATA_DIR || path.join(__dirname, '..', '..', 'data');
const historyPath = () => path.join(dataDir(), 'alert-history.jsonl');
const auditPath = () => path.join(dataDir(), 'admin-audit.jsonl');

let writesSinceTrim = 0;

function maybeTrim() {
  writesSinceTrim++;
  if (writesSinceTrim < TRIM_EVERY) return;
  writesSinceTrim = 0;
  try {
    trimJsonLines(historyPath(), MAX_HISTORY_ENTRIES);
    trimJsonLines(auditPath(), MAX_AUDIT_ENTRIES);
  } catch (err) {
    console.error(`[alertHistory] Could not trim logs: ${err.message}`);
  }
}

/**
 * Record one email attempt.
 * @param {{fleetId:number, status:'sent'|'failed', test?:boolean, sentBy?:string,
 *          subject:string, to:string[], cc?:string[], bcc?:string[],
 *          items?:Array, messageId?:string, error?:string}} entry
 * @returns {Object} the stored entry
 */
function recordEmail(entry) {
  const stored = {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    fleetId: entry.fleetId,
    status: entry.status,
    test: !!entry.test,
    sentBy: entry.sentBy || 'monitor',
    subject: entry.subject,
    to: entry.to || [],
    cc: entry.cc || [],
    bcc: entry.bcc || [],
    items: (entry.items || []).map((i) => ({
      kind: i.kind, vehicleId: i.vehicleId, vehicleName: i.vehicleName,
      celsius: i.celsius, threshold: i.threshold, at: i.at,
    })),
    messageId: entry.messageId || null,
    error: entry.error || null,
  };
  try {
    appendJsonLine(historyPath(), stored);
    maybeTrim();
  } catch (err) {
    console.error(`[alertHistory] Could not write history: ${err.message}`);
  }
  return stored;
}

/**
 * Newest-first page of email history.
 * @param {{fleetId?:number|null, status?:string|null, limit?:number, before?:string|null}} [q]
 * @returns {{entries:Object[], hasMore:boolean}}
 */
function listEmails({ fleetId = null, status = null, limit = 50, before = null } = {}) {
  const max = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500);
  const all = readJsonLines(historyPath()).reverse();
  const filtered = all.filter((e) =>
    (fleetId === null || e.fleetId === fleetId) &&
    (!status || e.status === status) &&
    (!before || e.at < before)
  );
  return { entries: filtered.slice(0, max), hasMore: filtered.length > max };
}

/**
 * Record an admin action.
 * @param {{actor:string, action:string, ip?:string, fleetId?:number, details?:Object}} entry
 */
function recordAudit(entry) {
  try {
    appendJsonLine(auditPath(), { at: new Date().toISOString(), ...entry });
    maybeTrim();
  } catch (err) {
    console.error(`[alertHistory] Could not write audit log: ${err.message}`);
  }
}

/** Newest-first admin audit entries. */
function listAudit({ limit = 100 } = {}) {
  const max = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);
  return readJsonLines(auditPath()).reverse().slice(0, max);
}

module.exports = { recordEmail, listEmails, recordAudit, listAudit };
