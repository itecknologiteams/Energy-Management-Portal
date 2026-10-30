'use strict';

/**
 * Alert service — pure rules for deciding when a reading is an alert.
 * No database or network access here, so it is fully unit-testable.
 */

const { getAlertConfig, getTemperatureThreshold } = require('../config/alertConfig');

/**
 * Compare a temperature reading with the vehicle's configured threshold.
 *
 * @param {number|string} vehicleId
 * @param {number|null} celsius - latest reading, or null when no probe data
 * @param {Object} [cfg] - alert config (defaults to the live config)
 * @returns {{ temperatureThreshold:number|null, temperatureAlert:boolean }}
 */
function evaluateTemperature(vehicleId, celsius, cfg = getAlertConfig()) {
  if (!cfg.temperature.enabled) {
    return { temperatureThreshold: null, temperatureAlert: false };
  }
  const threshold = getTemperatureThreshold(vehicleId, cfg);
  const isAlert = typeof celsius === 'number' && Number.isFinite(celsius) && celsius > threshold;
  return { temperatureThreshold: threshold, temperatureAlert: isAlert };
}

/**
 * Add temperatureThreshold / temperatureAlert to an analytics object.
 * Returns the same object for chaining; null/undefined pass through.
 */
function attachTemperatureAlert(vehicleId, analytics, cfg = getAlertConfig()) {
  if (!analytics) return analytics;
  Object.assign(analytics, evaluateTemperature(vehicleId, analytics.temperature ?? null, cfg));
  return analytics;
}

// ─── Time helpers ─────────────────────────────────────────────────────────────

/** Minutes the zone is ahead of UTC at `date` (e.g. +300 for Asia/Karachi). */
function timezoneOffsetMinutes(timezone, date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(date).map((p) => [p.type, p.value])
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

/**
 * "Now" on the same clock as the tracking timestamps. The GPS server stores
 * local wall-clock time without a zone, and mssql reads it as UTC — so a
 * reading taken right now in Karachi looks 5 h in the future unless "now" is
 * shifted the same way.
 *
 * @param {Object} [cfg]
 * @param {Date} [now]
 * @returns {Date}
 */
function dbClockNow(cfg = getAlertConfig(), now = new Date()) {
  if (!cfg.dbTimestampsAreLocalTime) return now;
  return new Date(now.getTime() + timezoneOffsetMinutes(cfg.timezone, now) * 60000);
}

/** Today's date (YYYY-MM-DD) in the configured timezone — the daily table to read. */
function localDateString(cfg = getAlertConfig(), now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: cfg.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

/**
 * Human-readable time for a tracking timestamp, in the configured timezone.
 * @param {Date|string} at
 * @param {Object} [cfg]
 */
function formatReadingTime(at, cfg = getAlertConfig()) {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return String(at);
  // Local-time timestamps are already wall-clock values; print them as stored.
  const timeZone = cfg.dbTimestampsAreLocalTime ? 'UTC' : cfg.timezone;
  return d.toLocaleString('en-GB', {
    timeZone, day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

module.exports = {
  evaluateTemperature,
  attachTemperatureAlert,
  timezoneOffsetMinutes,
  dbClockNow,
  localDateString,
  formatReadingTime,
};
