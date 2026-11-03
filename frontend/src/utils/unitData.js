// Helpers shared by the unit dashboard cards.

// Tracking timestamps are PKT wall-clock values that arrive labelled as UTC,
// so they run this far ahead of the real UTC instant.
export const TRACKING_OFFSET_MS = 5 * 60 * 60 * 1000;

// Minutes after which a unit with no new reading counts as offline
export const OFFLINE_AFTER_MINUTES = 60;

/** Format a tracking timestamp as the PKT wall-clock time it represents. */
export function formatTrackingTime(ts, options = { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-GB', { ...options, timeZone: 'UTC' });
}

/** Minutes since a tracking timestamp, on the real clock. */
export function minutesSince(ts) {
  if (!ts) return null;
  return Math.max(0, (Date.now() - (new Date(ts).getTime() - TRACKING_OFFSET_MS)) / 60000);
}

export function formatAgo(ts) {
  const m = minutesSince(ts);
  if (m === null) return '—';
  if (m < 1) return 'just now';
  if (m < 60) return `${Math.round(m)} min ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} days ago`;
}

/**
 * The calibration curve of a unit's fuel sensor, if it has one.
 * @returns {Array<{x:number,y:number}>|null}
 */
export function fuelCalibration(unit) {
  const keys = new Set(unit?.sensors?.fuelKeys || []);
  const info = Object.values(unit?.sensors?.byParam || {}).find(
    (s) => keys.has(s.sensorKey) && Array.isArray(s.calibration) && s.calibration.length >= 2
  );
  return info ? info.calibration : null;
}

/** Tank capacity in litres: the top of the fuel sensor's calibration curve. */
export function fuelCapacity(unit) {
  const cal = fuelCalibration(unit);
  if (!cal) return null;
  const max = Math.max(...cal.map((p) => Number(p.y)).filter(Number.isFinite));
  return Number.isFinite(max) && max > 0 ? max : null;
}

/** Current fuel in litres, or null when the unit has no reading. */
export function currentFuel(unit) {
  const f = unit?.fuelLevel;
  return typeof f === 'number' && Number.isFinite(f) ? f : null;
}

/**
 * Running / Stopped / Offline, with the colours the cards use.
 */
export function unitStatus(unit) {
  const ago = minutesSince(unit?.lastReadingAt);
  if (unit?.lastUpdate || ago === null || ago > OFFLINE_AFTER_MINUTES) {
    return { label: 'Offline', dot: 'bg-gray-400', pill: 'bg-gray-100 text-gray-600' };
  }
  if (unit?.status === 'Running') {
    return { label: 'Running', dot: 'bg-green-500', pill: 'bg-green-50 text-green-700' };
  }
  return { label: 'Stopped', dot: 'bg-amber-500', pill: 'bg-amber-50 text-amber-700' };
}

// Litres and volts use two decimals, as the GPS server shows them
export const fmt2 = (n) => (n === null || n === undefined || Number.isNaN(Number(n)) ? '—' : Number(n).toFixed(2));

export const fmt1 = (n) => (n === null || n === undefined || Number.isNaN(Number(n)) ? '—' : Number(n).toFixed(1));

export const fmtHours = (n) =>
  n === null || n === undefined ? '—' : Number(n).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
