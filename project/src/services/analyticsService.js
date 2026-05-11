'use strict';

/**
 * Analytics Service — calculates vehicle metrics from tracking data.
 *
 * ── Database discoveries (2026-04-15) ───────────────────────────────────────
 *
 * 1. ALL vehicles in this fleet use VehicleSensors.param = "io9" for the fuel
 *    sensor.  The raw ADC value (0–~5000) is stored in the Battery column of
 *    TrackData.  FuelLevel and Params are always NULL for these devices.
 *    Calibration from VehicleSensors converts: raw ADC → litres.
 *
 * 2. Some vehicles (e.g. 373197, 375957) store the actual 12 V power-supply
 *    voltage in Battery (values 10,000–15,000 mV). Those are NOT fuel ADC
 *    readings. Guard: skip Battery if rawValue > calibrationMaxX × 1.2.
 *
 * 3. Ignition is a SQL bit column → mssql returns JS boolean (true/false).
 *    parseInt(true, 10) === NaN, breaking all ignition math.
 *    Fixed: parseIgnitionState() handles booleans.
 *
 * 4. Battery column = fuel ADC; BackupBattery = GPS device internal battery.
 *
 * ── Fuel theft rule ─────────────────────────────────────────────────────────
 *
 * Theft is only meaningful when the generator is OFF (ignition = 0).
 * ADC sensor noise causes spurious spikes at the moment of ignition
 * transition (0-minute "OFF" windows that show 40-50 L drops) — these are
 * filtered out by requiring the drop to occur during ignition=0 state.
 *
 * ── Fuel consumption rule ───────────────────────────────────────────────────
 *
 * True consumption uses mass-balance formula:
 *   consumed = max(0, (firstFuel - lastFuel) + totalRefueled)
 */

const {
  MIN_VALID_RUNNING_MINUTES,
  DEBUG_MODE,
} = require('../constants');

// ─── Multi-layer fuel detection constants ────────────────────────────────────

const FUEL_MEDIAN_SAMPLES        = 5;    // causal backward-looking window
const DROP_ALERT_THRESHOLD       = 8;    // L — candidate theft/loss
const RISE_THRESHOLD             = 8;    // L — candidate refuel
const NOISE_THRESHOLD            = 0.5;  // L — ignore changes below this
const SPIKE_WINDOW_MINUTES       = 7;    // min — half-width for ±7 min window
const POST_DROP_VERIFY_EPS       = 1.5;  // L — recovery tolerance post-drop
const POST_REFUEL_VERIFY_EPS     = 8.0;  // L — fallback tolerance post-refuel
const RISE_RECOVERY_EPS          = 2.0;  // L — tolerance in isRecoveryRise
const RISE_RECOVERY_LOOKBACK_MIN = 7;    // min — lookback for isRecoveryRise
const REFUEL_CONSOLIDATION_MIN   = 15;   // min — forward scan for refuel peak
const MAX_SINGLE_READING_DROP    = 2.0;  // L — sensor jump flag
const POWER_EVENT_SUPPRESSION_MIN = 60;  // min — suppress theft detection after a power event
const SPIKE_FORWARD_WINDOW_MINUTES = 30; // min — extended forward recovery window for isFakeSpike
const MIN_VALID_FUEL_READING     = 10;   // L — discard ADC-near-zero garbage readings
const POST_RUN_GUARD_MINUTES     = 30;   // min — suppress theft if generator ran recently
const MIN_RUN_DURATION_MS        = 60 * 1000; // ms — minimum ON period to count as a run
const MIN_BACKUP_VOLT_MV         = 10;        // mV — treat ignition as OFF if backup battery ≤ this
const BASELINE_LOOKBACK_MS       = 30 * 60 * 1000; // ms — window behind drop to scan for baseline support
const MIN_BASELINE_SUSTAINED_MS  = 20 * 60 * 1000; // ms — baseline must be present for this long to be real

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN ENTRY POINT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Calculate comprehensive analytics for a vehicle's daily tracking data.
 *
 * @param {number} vehicleId
 * @param {string} date - YYYY-MM-DD
 * @param {Object} sensorKeys - from sensorMapper.resolveSensorKeys()
 * @param {Array}  trackingRows - ordered ASC by timestamp
 * @param {Array}  [warmupRows=[]] - rows from warmup period before trackingRows
 * @returns {Object}
 */
function calculateVehicleAnalytics(vehicleId, date, sensorKeys, trackingRows, warmupRows = []) {
  if (!trackingRows || !Array.isArray(trackingRows) || trackingRows.length === 0) {
    return createEmptyAnalytics();
  }

  // Drop records with timestamps in the future (pre-loaded test data / device clock drift)
  const now = Date.now();
  const trackingRowsFiltered = trackingRows.filter(
    (r) => new Date(r.timestamp).getTime() <= now
  );
  if (trackingRowsFiltered.length === 0) return createEmptyAnalytics();
  trackingRows = trackingRowsFiltered; // eslint-disable-line no-param-reassign

  if (DEBUG_MODE) {
    const first = trackingRows[0];
    const last  = trackingRows[trackingRows.length - 1];
    console.log('[analyticsService] vehicle=%d date=%s rows=%d', vehicleId, date, trackingRows.length);
    console.log('[analyticsService] first:', {
      ignition: first.ignition, battery: first.battery,
      backupBattery: first.backupBattery, fuelLevel: first.fuelLevel,
      params: first.params ? first.params.substring(0, 80) : null,
    });
    console.log('[analyticsService] last:', {
      ignition: last.ignition, battery: last.battery,
      backupBattery: last.backupBattery,
    });
  }

  const fuelCalibration = resolveFuelCalibration(sensorKeys);
  const fuelSensorKey   = sensorKeys?.fuelKeys?.[0] ?? null;
  const calibrationMaxX = fuelCalibration
    ? Math.max(...fuelCalibration.map((p) => p.x))
    : Infinity;

  // DEBUG: Log fuel calibration and raw values for troubleshooting
  if (DEBUG_MODE) {
    console.log('[analyticsService] Fuel Debug for vehicle=%d:', vehicleId);
    console.log('  - fuelSensorKey:', fuelSensorKey ?? 'NOT SET');
    console.log('  - fuelCalibration:', JSON.stringify(fuelCalibration));
    if (trackingRows.length > 0) {
      const lastRow = trackingRows[trackingRows.length - 1];
      const params = parseParams(lastRow.params);
      console.log('  - Last row battery:', lastRow.battery);
      console.log('  - Last row fuelLevel:', lastRow.fuelLevel);
      console.log('  - Last row params:', JSON.stringify(params));
      const rawValue = parseNumeric(lastRow.battery) || getParamValue(params, fuelSensorKey);
      console.log('  - Raw ADC value:', rawValue);
      if (fuelCalibration && rawValue) {
        const calibrated = applyCalibration(rawValue, fuelCalibration);
        console.log('  - Calibrated fuel:', calibrated, 'L');
      }
    }
  }

  // Build merged series over all rows (warmup + tracking)
  const allRows = [...warmupRows, ...trackingRows];
  const { series: rawSeries, powerEvents, preferredFuelPoints, batteryFallbackPoints } = buildFuelIgnitionSeries(allRows, fuelCalibration, fuelSensorKey, calibrationMaxX);
  const smoothed   = smoothFuelIgnitionSeries(rawSeries);

  // dayStart is used to exclude warmup-period events from the results
  const dayStart = warmupRows.length > 0 ? new Date(trackingRows[0].timestamp) : null;

  // Detect theft drops and refuel events using the multi-layer algorithm
  const { theftDrops, refuels } = detectFuelEvents(rawSeries, smoothed, dayStart, powerEvents);

  // Narrow down to the day's smoothed series for consumption calculation
  const daySmoothed = dayStart
    ? smoothed.filter((pt) => pt.timestamp >= dayStart)
    : smoothed;

  const totalRefueled = refuels.reduce((s, r) => s + r.added, 0);
  const totalTheft    = theftDrops.reduce((s, d) => s + d.consumed, 0);
  const fuelTheftAt   = theftDrops.length > 0 ? theftDrops[0].at : null;

  // For consumption: only refuels that occurred before the last ignition-on moment.
  // Post-run refuels top up the tank after the engine stops and must not offset
  // the mass-balance formula (which already anchors lastFuel at the last run end).
  const lastIgnPt = [...daySmoothed].reverse().find((pt) => pt.ignition === 1);
  const lastIgnTime = lastIgnPt ? lastIgnPt.timestamp : null;
  const consumptionRefueled = lastIgnTime
    ? refuels.filter((r) => new Date(r.at) < lastIgnTime).reduce((s, r) => s + r.added, 0)
    : totalRefueled;

  // Compute runs first — phantom carryover days return an empty array.
  // If there are no qualifying runs, the generator did not run on this day
  // and fuel consumption must be 0 (avoids attributing cross-midnight fuel
  // delta on stuck-ignition days to the period total).
  const generatorRuns = calculateGeneratorRunIntervals(trackingRows);
  const fuelConsumption = generatorRuns.length > 0
    ? calculateFuelConsumption(daySmoothed, consumptionRefueled, preferredFuelPoints, batteryFallbackPoints)
    : 0;

  return {
    batteryHealth:      calculateBatteryHealth(trackingRows),
    fuelConsumption,
    totalEngineHours:   calculateTotalEngineHours(trackingRows),
    fuelRefilled:       round(totalRefueled, 2) || 0,
    fuelTheft:          round(totalTheft, 2) || 0,
    fuelTheftAt,
    generatorStartTime: calculateGeneratorStartTime(trackingRows),
    generatorStopTime:  calculateGeneratorStopTime(trackingRows),
    generatorRuns,
    workTime:           calculateWorkTime(trackingRows),
    fuel:               getFinalFuelValue(rawSeries),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// FUEL + IGNITION SERIES BUILDER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Build a merged time-series of {timestamp, fuel (litres), ignition (0|1)}
 * from raw tracking rows.
 *
 * Fuel source priority (stops at first non-null value):
 *   1. FuelLevel column (CAN bus, already in litres)
 *   2. Params[fuelSensorKey]  (io9 → key "9"; io327 → key "327") + calibrate
 *   3. Params["327"] default fallback + calibrate
 *   4. Battery column — ONLY when rawValue ≤ calibrationMaxX × 1.2
 *      (skips vehicles where Battery stores 12 V supply voltage ~14 000 mV)
 *
 * @param {Array}       rows
 * @param {Array|null}  calibration
 * @param {string|null} fuelSensorKey  e.g. "9" derived from "io9"
 * @param {number}      calibrationMaxX  max x from calibration curve
 * @returns {Array<{timestamp:Date, fuel:number, ignition:0|1|null}>}
 */
function buildFuelIgnitionSeries(rows, calibration, fuelSensorKey, calibrationMaxX) {
  const series = [];
  const powerEvents = []; // timestamps of high-battery exclusions (device power events)
  let preferredFuelPoints = 0; // points from FuelLevel or Params (reliable)
  let batteryFallbackPoints = 0; // points from Battery column (may be device voltage)

  for (const row of rows) {
    let fuel = null;
    let needsCalibration = false;

    let usedBatteryFallback = false;

    // 1. FuelLevel column (already litres)
    const fl = parseNumeric(row.fuelLevel);
    if (fl !== null) {
      fuel = fl;
    }

    // 2. Params[fuelSensorKey] (raw ADC → calibrate)
    if (fuel === null && fuelSensorKey) {
      const params = parseParams(row.params);
      const pv = getParamValue(params, fuelSensorKey);
      if (pv !== null) { fuel = pv; needsCalibration = true; }
    }

    // 3. Params["327"] default
    if (fuel === null) {
      const params = parseParams(row.params);
      const p327 = getParamValue(params, '327');
      if (p327 !== null) { fuel = p327; needsCalibration = true; }
    }

    // 4. Battery column — only when value is plausibly a fuel ADC reading.
    //    Vehicles 373197/375957 store actual 12 V supply (~11 000–15 000 mV)
    //    in Battery, which far exceeds the calibration range (max ~5 000).
    //    Allow values up to 2x calibration max to handle extrapolation,
    //    or use default max of 6000 when no calibration exists.
    if (fuel === null) {
      const batRaw = parseNumeric(row.battery);
      const maxAllowed = calibration ? calibrationMaxX * 2.0 : 6000;
      if (batRaw !== null && batRaw > maxAllowed) {
        // Battery far above calibration range: marks a device power event
        // (e.g., charger connected, supply voltage spike). Record the timestamp
        // so theft detection can guard against readings taken during power instability.
        powerEvents.push(new Date(row.timestamp));
      } else if (batRaw !== null && batRaw >= 0) {
        fuel = batRaw;
        needsCalibration = true;
        usedBatteryFallback = true;
      }
    }

    if (fuel === null) continue;

    if (needsCalibration) {
      if (calibration) {
        fuel = applyCalibration(fuel, calibration);
      } else {
        continue; // raw ADC without a calibration curve cannot be converted to litres
      }
    }

    if (Number.isNaN(fuel)) continue;

    // Discard calibrated readings below plausible minimum — ADC near-zero
    // garbage (e.g. raw 264 → 10.3 L) distorts the median and causes false drops.
    if (fuel < MIN_VALID_FUEL_READING) continue;

    if (usedBatteryFallback) {
      batteryFallbackPoints++;
    } else {
      preferredFuelPoints++;
    }

    series.push({
      timestamp: new Date(row.timestamp),
      fuel,
      ignition: effectiveIgnition(row),
    });
  }

  return { series, powerEvents, preferredFuelPoints, batteryFallbackPoints };
}

/**
 * Layer 1 — Causal N-sample median filter.
 *
 * For each point i, takes the median of series[max(0,i-N+1)...i] (backward-
 * looking window of up to N samples). Preserves real step changes while
 * suppressing single-sample ADC spikes. Ignition is decided by majority vote
 * of the same window.
 *
 * @param {Array<{timestamp,fuel,ignition}>} series  Raw fuel+ignition series
 * @param {number} [samples=FUEL_MEDIAN_SAMPLES]
 * @returns {Array<{timestamp,fuel,ignition}>}
 */
function smoothFuelIgnitionSeries(series, samples = FUEL_MEDIAN_SAMPLES) {
  if (series.length === 0) return [];

  return series.map((pt, i) => {
    const win    = series.slice(Math.max(0, i - samples + 1), i + 1);
    const sorted = win.map((p) => p.fuel).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const onCnt  = win.filter((p) => p.ignition === 1).length;
    const offCnt = win.filter((p) => p.ignition === 0).length;
    return {
      timestamp: pt.timestamp,
      fuel:      median,
      ignition:  onCnt > offCnt ? 1 : offCnt > onCnt ? 0 : pt.ignition,
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// LAYER 3a — isFakeSpike (drop check)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Returns true if a large drop at `dropTime` is a sensor glitch rather than
 * real theft/loss. Uses raw (unfiltered) readings in the ±SPIKE_WINDOW_MINUTES
 * window around the drop timestamp. Speed checks are omitted — generators are
 * stationary.
 *
 * @param {Array<{timestamp:Date,fuel:number}>} raw
 * @param {Date} dropTime
 * @returns {boolean}
 */
function isFakeSpike(raw, dropTime) {
  const backMs    = SPIKE_WINDOW_MINUTES * 60 * 1000;
  const forwardMs = SPIKE_FORWARD_WINDOW_MINUTES * 60 * 1000;
  const win = raw.filter(
    (pt) =>
      pt.timestamp >= new Date(dropTime.getTime() - backMs) &&
      pt.timestamp <= new Date(dropTime.getTime() + forwardMs)
  );
  if (win.length < 2) return false;

  const startFuel = win[0].fuel;
  const finalFuel = win[win.length - 1].fuel;

  // Check 2: full recovery → fake
  if (finalFuel >= startFuel) return true;

  // Check 3: near recovery → fake
  if (Math.abs(finalFuel - startFuel) <= DROP_ALERT_THRESHOLD) return true;

  // Check 4: sub-drop scan
  let foundLarge = false;
  for (let j = 0; j < win.length - 1; j++) {
    const sub = win[j].fuel - win[j + 1].fuel;
    if (sub >= DROP_ALERT_THRESHOLD) {
      foundLarge = true;
      // Directional check: "stayed low" means fuel remained BELOW the pre-drop
      // level, not merely "far from" it. Using abs() would incorrectly treat
      // readings that recovered ABOVE the baseline as "staying low."
      const stayedLow = win
        .slice(j + 1)
        .every((r) => r.fuel < win[j].fuel - DROP_ALERT_THRESHOLD);
      if (stayedLow) return false; // sustained → real
    }
  }
  // All large sub-drops recovered → fake; no large sub-drops → real (gradual)
  return foundLarge;
}

// ═══════════════════════════════════════════════════════════════════════════════
// LAYER 3b — isFakeRise (refuel check)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Returns true if a large rise at `riseTime` is a sensor glitch rather than
 * a real refuel. Uses raw readings in ±SPIKE_WINDOW_MINUTES around riseTime.
 * Speed checks omitted (stationary generators).
 *
 * @param {Array<{timestamp:Date,fuel:number}>} raw
 * @param {Date} riseTime
 * @param {number} baseline  Fuel level before the rise
 * @param {number} peakFuel  Peak fuel level after consolidation
 * @returns {boolean}
 */
function isFakeRise(raw, riseTime, baseline, peakFuel) {
  // Asymmetric window: extend backward to catch cases where the raw series
  // already shows peak-level readings before the smoothed "rise" (median
  // artifact from a prior dip flushing out of the 5-sample window).
  const backMs    = SPIKE_FORWARD_WINDOW_MINUTES * 60 * 1000; // 30 min
  const forwardMs = SPIKE_WINDOW_MINUTES * 60 * 1000;         // 7 min
  const win = raw.filter(
    (pt) =>
      pt.timestamp >= new Date(riseTime.getTime() - backMs) &&
      pt.timestamp <= new Date(riseTime.getTime() + forwardMs)
  );
  if (win.length < 2) return false;

  const finalFuel = win[win.length - 1].fuel;

  // Check 3: fell back to or below pre-rise baseline → fake.
  // Use the provided baseline (smoothed pre-rise level) rather than win[0].fuel,
  // because with sparse readings the 30-min backward window may start AFTER the
  // actual refuel, making win[0] already reflect the post-refuel level.
  if (finalFuel <= baseline) return true;

  // Check 4: did not sustain enough gain from baseline → fake
  if (Math.abs(finalFuel - baseline) <= RISE_THRESHOLD) return true;

  // Check 5: sub-rise scan
  for (let j = 0; j < win.length - 1; j++) {
    const sub = win[j + 1].fuel - win[j].fuel;
    if (sub >= RISE_THRESHOLD) {
      const stayedHigh = win
        .slice(j + 1)
        .every((r) => Math.abs(r.fuel - win[j].fuel) > RISE_THRESHOLD);
      // stayedHigh → real; fell back → fake
      return !stayedHigh;
    }
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// LAYER 3c — isRecoveryRise
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Returns true when a "rise" is actually the sensor recovering from a prior
 * temporary dip — i.e., fuel was already near peak before the detected rise.
 *
 * Guard: skipped when a confirmed theft drop occurred within the last 60 min
 * (that would be a real refuel after real theft, not a recovery).
 *
 * @param {Array<{timestamp:Date,fuel:number}>} raw
 * @param {Date}        riseTime
 * @param {number}      baseline
 * @param {number}      peakFuel
 * @param {Date|null}   lastConfirmedDropTime
 * @returns {boolean}
 */
function isRecoveryRise(raw, riseTime, baseline, peakFuel, lastConfirmedDropTime) {
  // Guard: skip if a confirmed drop was within 60 min of this rise
  if (lastConfirmedDropTime) {
    const diffMs = riseTime.getTime() - lastConfirmedDropTime.getTime();
    if (diffMs <= 60 * 60 * 1000) return false;
  }

  const lookbackMs = RISE_RECOVERY_LOOKBACK_MIN * 60 * 1000;
  const win = raw.filter(
    (pt) =>
      pt.timestamp >= new Date(riseTime.getTime() - lookbackMs) &&
      pt.timestamp < riseTime
  );
  if (win.length === 0) return false;

  const fuels  = win.map((p) => p.fuel);
  const preMax = Math.max(...fuels);
  const preMin = Math.min(...fuels);

  return (
    preMax >= peakFuel - RISE_RECOVERY_EPS &&
    preMin <= baseline + RISE_RECOVERY_EPS &&
    preMax - preMin >= RISE_THRESHOLD
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// LAYER 3d — isStationaryDropRecovery
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Returns true when the rise is merely a recovery from a prior sensor glitch
 * that occurred while the generator was parked. Simplified: no speed checks
 * (generators are always stationary).
 *
 * Scans backwards 90 min from riseTime. If a consecutive pair shows a drop
 * ≥ DROP_ALERT_THRESHOLD while the "before" reading was at near-peak level,
 * the current rise is just that glitch recovering.
 *
 * @param {Array<{timestamp:Date,fuel:number}>} raw
 * @param {Date}   riseTime
 * @param {number} peakFuel
 * @returns {boolean}
 */
function isStationaryDropRecovery(raw, riseTime, peakFuel) {
  const lookbackMs = 90 * 60 * 1000;
  const win = raw.filter(
    (pt) =>
      pt.timestamp >= new Date(riseTime.getTime() - lookbackMs) &&
      pt.timestamp < riseTime
  );

  for (let j = 0; j < win.length - 1; j++) {
    const drop = win[j].fuel - win[j + 1].fuel;
    if (
      drop >= DROP_ALERT_THRESHOLD &&
      win[j].fuel >= peakFuel - RISE_RECOVERY_EPS
    ) {
      return true; // prior glitch drop while near peak → this rise is recovery
    }
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// LAYER 4a — isDropConfirmedAfterDelay
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Mirrors the Python monitoring script's ~80-second verify delay. Checks
 * whether the fuel is still low in the first reading within 10 min after the
 * drop. Speed checks omitted (stationary generators).
 *
 * @param {Array<{timestamp:Date,fuel:number}>} filtered
 * @param {Date}   dropTime
 * @param {number} baseline  Fuel level just before the drop
 * @returns {boolean}  true = drop confirmed (still low)
 */
function isDropConfirmedAfterDelay(filtered, dropTime, baseline) {
  const verifyRow = filtered.find(
    (pt) =>
      pt.timestamp > dropTime &&
      pt.timestamp <= new Date(dropTime.getTime() + 10 * 60 * 1000)
  );

  if (!verifyRow) return true; // data gap → assume still dropped (conservative)

  const stillDropped =
    verifyRow.fuel < baseline &&
    (baseline - verifyRow.fuel) >= DROP_ALERT_THRESHOLD;

  return stillDropped;
}

// ═══════════════════════════════════════════════════════════════════════════════
// LAYER 4b — isPostDropRecovery
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Checks the (+7 min, +14 min] window after the drop. If fuel recovered
 * within POST_DROP_VERIFY_EPS of baseline, this was a slow-recovering glitch.
 *
 * @param {Array<{timestamp:Date,fuel:number}>} filtered
 * @param {Date}   dropTime
 * @param {number} baseline
 * @returns {boolean}  true = recovered (fake)
 */
function isPostDropRecovery(filtered, dropTime, baseline) {
  const lo = new Date(dropTime.getTime() + SPIKE_WINDOW_MINUTES * 60 * 1000);
  const hi = new Date(dropTime.getTime() + 2 * SPIKE_WINDOW_MINUTES * 60 * 1000);
  const post = filtered.filter((pt) => pt.timestamp > lo && pt.timestamp <= hi);

  if (post.length === 0) return false; // no data → conservative (assume real)

  return post[post.length - 1].fuel >= baseline - POST_DROP_VERIFY_EPS;
}

// ═══════════════════════════════════════════════════════════════════════════════
// REFUEL CONSOLIDATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * After a detected rise, scan forward up to REFUEL_CONSOLIDATION_MIN minutes
 * to find the true peak fuel level (a physical refuel may take several steps).
 *
 * @param {Array<{timestamp:Date,fuel:number}>} filtered
 * @param {number} riseIdx   Index in `filtered` where the rise was detected
 * @param {number} baseline  Fuel level just before the rise
 * @returns {{ peakFuel:number, consolidationEnd:Date, falledBack:boolean }}
 */
function refuelConsolidation(filtered, riseIdx, baseline) {
  const riseTime     = filtered[riseIdx].timestamp;
  const consolidEnd  = new Date(riseTime.getTime() + REFUEL_CONSOLIDATION_MIN * 60 * 1000);

  let peakFuel         = filtered[riseIdx].fuel;
  let consolidationEnd = filtered[riseIdx].timestamp;
  let falledBack       = false;

  for (let k = riseIdx + 1; k < filtered.length; k++) {
    const pt = filtered[k];
    if (pt.timestamp > consolidEnd) break;

    consolidationEnd = pt.timestamp;

    if (pt.fuel > peakFuel) {
      peakFuel = pt.fuel; // still rising → update peak
    } else if (
      pt.fuel < baseline + RISE_THRESHOLD &&
      peakFuel - pt.fuel > RISE_THRESHOLD
    ) {
      falledBack = true; // significant drop from peak → stop
      break;
    }
  }

  return { peakFuel, consolidationEnd, falledBack };
}

// ═══════════════════════════════════════════════════════════════════════════════
// LAYER 4c — isPostRefuelFallback
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * After the refuel consolidation window, checks the (+7 min, +14 min] window.
 * If fuel fell significantly from peak → likely a fake spike. A 75% retention
 * override accepts the refuel even if fuel settled somewhat below peak.
 *
 * @param {Array<{timestamp:Date,fuel:number}>} filtered
 * @param {Date}   consolidationEnd  Last timestamp of the consolidation scan
 * @param {number} peakFuel
 * @param {number} baseline
 * @returns {boolean}  true = fake (fell back), false = real refuel
 */
function isPostRefuelFallback(filtered, consolidationEnd, peakFuel, baseline) {
  const lo = new Date(consolidationEnd.getTime() + SPIKE_WINDOW_MINUTES * 60 * 1000);
  const hi = new Date(consolidationEnd.getTime() + 2 * SPIKE_WINDOW_MINUTES * 60 * 1000);
  let post = filtered.filter((pt) => pt.timestamp > lo && pt.timestamp <= hi);

  // Extend window if no readings found
  if (post.length === 0) {
    const hiExt = new Date(consolidationEnd.getTime() + 30 * 60 * 1000);
    post = filtered.filter((pt) => pt.timestamp > lo && pt.timestamp <= hiExt);
  }

  if (post.length === 0) return false; // no data → conservative (assume real)

  const lastPostFuel = post[post.length - 1].fuel;

  if (lastPostFuel >= peakFuel - POST_REFUEL_VERIFY_EPS) {
    return false; // held near peak → real refuel
  }

  // 75% retention override: if settled fuel is still well above baseline,
  // accept it as a real refuel with minor post-fill settling / consumption.
  const retainThreshold = baseline + 0.75 * (peakFuel - baseline);
  if (lastPostFuel > retainThreshold) {
    return false; // override — real refuel with minor settling
  }

  return true; // fell back → fake
}

// ═══════════════════════════════════════════════════════════════════════════════
// POST-RUN GUARD — wasRecentlyRunning
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Returns true if the generator ran for at least MIN_RUN_DURATION_MS in the
 * POST_RUN_GUARD_MINUTES window before `dropTime`. Fuel drops immediately
 * after a confirmed run are consumption settling, not theft.
 *
 * @param {Array<{timestamp:Date,ignition:0|1|null}>} raw
 * @param {Date} dropTime
 * @returns {boolean}
 */
function wasRecentlyRunning(raw, dropTime) {
  const lo = new Date(dropTime.getTime() - POST_RUN_GUARD_MINUTES * 60 * 1000);
  let runStart = null;
  for (const pt of raw) {
    if (pt.timestamp < lo || pt.timestamp >= dropTime) continue;
    if (pt.ignition === 1) {
      if (!runStart) runStart = pt.timestamp;
      if (pt.timestamp.getTime() - runStart.getTime() >= MIN_RUN_DURATION_MS) return true;
    } else {
      runStart = null;
    }
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN EVENT DETECTION — detectFuelEvents
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Walk the filtered (smoothed) series and apply all detection layers to
 * produce confirmed theft-drop events and refuel events.
 *
 * @param {Array<{timestamp:Date,fuel:number,ignition:0|1|null}>} raw       Raw series
 * @param {Array<{timestamp:Date,fuel:number,ignition:0|1|null}>} filtered  Smoothed series
 * @param {Date|null} dayStart  Exclude events before this timestamp (warmup exclusion)
 * @param {Date[]} [powerEvents]  Timestamps of device power events (Battery > maxAllowed)
 * @returns {{ theftDrops: Array, refuels: Array }}
 */
function detectFuelEvents(raw, filtered, dayStart, powerEvents = []) {
  const theftDrops = [];
  const refuels    = [];
  let lastConfirmedDropTime = null;

  for (let i = 0; i < filtered.length - 1; i++) {
    const delta = filtered[i + 1].fuel - filtered[i].fuel;

    // Ignore noise
    if (Math.abs(delta) < NOISE_THRESHOLD) continue;

    // ── LARGE DROP ─────────────────────────────────────────────────────────
    if (delta <= -DROP_ALERT_THRESHOLD) {
      // Only count theft during OFF periods (generator off = ignition 0).
      //
      // Two-source ignition guard:
      //  - raw ignition can be transiently 0 during an ON run (ADC/device
      //    glitch), so the smoothed majority-vote catches those cases.
      //  - smoothed ignition lags at startup: the 5-sample window may still
      //    show 0 a few seconds into generator ON, so raw catches that.
      //
      // Require BOTH to agree the generator is OFF before proceeding.
      // raw[] and filtered[] are index-aligned (median filter maps 1-to-1).
      const rawIgn      = raw[i + 1] !== undefined ? raw[i + 1].ignition : null;
      const smoothedIgn = filtered[i + 1].ignition;
      if (rawIgn !== 0 || smoothedIgn !== 0) continue;

      // Skip warmup period
      if (dayStart && filtered[i + 1].timestamp < dayStart) continue;

      const baseline = filtered[i].fuel;
      const dropTime = filtered[i + 1].timestamp;

      // Baseline sustainability guard: the pre-drop fuel level must appear in
      // the raw series for at least MIN_BASELINE_SUSTAINED_MS within a
      // BASELINE_LOOKBACK_MS window before the drop. ADC power-on spikes and
      // sensor-settling artefacts are brief (< a few minutes); genuine theft
      // baselines persist for hours. The lookback window is wide enough to
      // include warmup-period readings, so early-morning real drops are not
      // excluded when warmup data exists.
      {
        const lookbackStart = new Date(dropTime.getTime() - BASELINE_LOOKBACK_MS);
        const atBaseline = raw.filter(
          (pt) =>
            pt.timestamp >= lookbackStart &&
            pt.timestamp <= dropTime &&
            Math.abs(pt.fuel - baseline) <= DROP_ALERT_THRESHOLD
        );
        if (atBaseline.length < 2) continue;
        const sustainedMs =
          atBaseline[atBaseline.length - 1].timestamp.getTime() -
          atBaseline[0].timestamp.getTime();
        if (sustainedMs < MIN_BASELINE_SUSTAINED_MS) continue;
      }

      // Post-run guard: fuel drops within 30 min of a >1 min generator run are
      // consumption settling (or sensor re-stabilisation), not theft.
      if (wasRecentlyRunning(raw, dropTime)) continue;

      // Forward scan within +SPIKE_WINDOW_MINUTES to find lowest confirmed fuel
      const scanEnd = new Date(dropTime.getTime() + SPIKE_WINDOW_MINUTES * 60 * 1000);
      let verifiedFuel = filtered[i + 1].fuel;
      for (let k = i + 2; k < filtered.length; k++) {
        if (filtered[k].timestamp > scanEnd) break;
        // Stop early if fuel recovered above (baseline - DROP_ALERT_THRESHOLD)
        if (filtered[k].fuel > baseline - DROP_ALERT_THRESHOLD) break;
        // Stop early if a refuel step is detected
        if (filtered[k].fuel - filtered[k - 1].fuel >= RISE_THRESHOLD) break;
        if (filtered[k].fuel < verifiedFuel) verifiedFuel = filtered[k].fuel;
      }

      const totalConsumed = baseline - verifiedFuel;
      if (totalConsumed < DROP_ALERT_THRESHOLD) continue;

      // Power event guard: if the device experienced a power event (Battery
      // exceeded calibration range, e.g. charger spike or supply fluctuation)
      // within the preceding POWER_EVENT_SUPPRESSION_MIN minutes, the ADC
      // ramp-down during that event can look like a fuel drop. Skip theft
      // detection for readings that fall within this unstable window.
      const suppressWindowMs = POWER_EVENT_SUPPRESSION_MIN * 60 * 1000;
      if (powerEvents.some(
        (pe) => pe <= dropTime &&
                dropTime.getTime() - pe.getTime() <= suppressWindowMs,
      )) continue;

      // Layer 4a — still low after delay?
      if (!isDropConfirmedAfterDelay(filtered, dropTime, baseline)) continue;

      // Layer 3a — sensor glitch check
      if (isFakeSpike(raw, dropTime)) continue;

      // Layer 4b — slow-recovering glitch check
      if (isPostDropRecovery(filtered, dropTime, baseline)) continue;

      theftDrops.push({
        at:       dropTime.toISOString(),
        before:   round(baseline, 2),
        after:    round(verifiedFuel, 2),
        consumed: round(totalConsumed, 2),
      });
      lastConfirmedDropTime = dropTime;
    }

    // ── LARGE RISE ──────────────────────────────────────────────────────────
    else if (delta >= RISE_THRESHOLD) {
      // Skip warmup period
      if (dayStart && filtered[i + 1].timestamp < dayStart) continue;

      const baseline = filtered[i].fuel;
      const riseTime = filtered[i + 1].timestamp;

      // Refuel consolidation — find true peak
      const { peakFuel, consolidationEnd, falledBack } =
        refuelConsolidation(filtered, i + 1, baseline);

      if (falledBack) continue; // peak collapsed in consolidation window → fake

      const totalAdded = peakFuel - baseline;
      if (totalAdded < RISE_THRESHOLD) continue;

      // Layer 3b — isFakeRise
      if (isFakeRise(raw, riseTime, baseline, peakFuel)) continue;

      // Layer 3c — isRecoveryRise
      if (isRecoveryRise(raw, riseTime, baseline, peakFuel, lastConfirmedDropTime)) continue;

      // Layer 3d — isStationaryDropRecovery
      if (isStationaryDropRecovery(raw, riseTime, peakFuel)) continue;

      // Layer 4c — isPostRefuelFallback
      if (isPostRefuelFallback(filtered, consolidationEnd, peakFuel, baseline)) continue;

      refuels.push({
        at:    riseTime.toISOString(),
        before: round(baseline, 2),
        after:  round(peakFuel, 2),
        added:  round(totalAdded, 2),
      });
    }
  }

  return { theftDrops, refuels };
}

// ═══════════════════════════════════════════════════════════════════════════════
// CALIBRATION
// ═══════════════════════════════════════════════════════════════════════════════

function resolveFuelCalibration(sensorKeys) {
  if (!sensorKeys?.byParam) return null;
  for (const param of Object.keys(sensorKeys.byParam)) {
    const info = sensorKeys.byParam[param];
    if (
      Array.isArray(info?.calibration) &&
      info.calibration.length >= 2 &&
      sensorKeys.fuelKeys?.includes(info.sensorKey)
    ) {
      return info.calibration;
    }
  }
  return null;
}

/**
 * Piecewise-linear interpolation through calibration points.
 * Clamps to min/max calibration values (matches vendor portal behavior).
 *
 * @param {number} rawValue
 * @param {Array<{x:number,y:number}>} calibrationPoints
 * @returns {number} Calibrated value
 */
function applyCalibration(rawValue, calibrationPoints) {
  if (!calibrationPoints || calibrationPoints.length < 2) return rawValue;
  const sorted = [...calibrationPoints].sort((a, b) => a.x - b.x);

  // Below minimum - clamp to minimum
  if (rawValue <= sorted[0].x) return sorted[0].y;

  // Beyond maximum - clamp to maximum (vendor portal behavior)
  if (rawValue >= sorted[sorted.length - 1].x) {
    return sorted[sorted.length - 1].y;
  }

  // Within range - interpolate
  for (let i = 0; i < sorted.length - 1; i++) {
    if (rawValue >= sorted[i].x && rawValue <= sorted[i + 1].x) {
      const ratio = (rawValue - sorted[i].x) / (sorted[i + 1].x - sorted[i].x);
      return sorted[i].y + ratio * (sorted[i + 1].y - sorted[i].y);
    }
  }
  return rawValue;
}

// ═══════════════════════════════════════════════════════════════════════════════
// IGNITION STATE PARSER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Parse ignition value that may be a JS boolean (mssql bit) or numeric.
 *
 * @param {boolean|number|string|null|undefined} value
 * @returns {0|1|null}
 */
function parseIgnitionState(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number')  return Number.isNaN(value) ? null : (value === 0 ? 0 : 1);
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? null : (parsed === 0 ? 0 : 1);
}

/**
 * Effective ignition: treats ignition as OFF when backup battery voltage is
 * at or below MIN_BACKUP_VOLT_MV. A reading near zero means the GPS device
 * has no external power — the generator is not actually running regardless
 * of the ignition bit.
 *
 * @param {Object} row - raw tracking row with .ignition and .backupBattery
 * @returns {0|1|null}
 */
function effectiveIgnition(row) {
  const ign = parseIgnitionState(row.ignition);
  if (ign !== 1) return ign;
  const batt = parseNumeric(row.backupBattery);
  if (batt !== null && batt <= MIN_BACKUP_VOLT_MV) return 0;
  return 1;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PARAMS PARSER
// ═══════════════════════════════════════════════════════════════════════════════

function parseParams(paramsStr) {
  if (!paramsStr || typeof paramsStr !== 'string') return {};
  try { return JSON.parse(paramsStr); } catch { return {}; }
}

function getParamValue(paramsObj, key) {
  if (!paramsObj || typeof paramsObj !== 'object') return null;
  const value = paramsObj[key];
  if (value === null || value === undefined) return null;
  const num = parseFloat(value);
  return Number.isNaN(num) ? null : num;
}

// ═══════════════════════════════════════════════════════════════════════════════
// METRIC CALCULATIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 1. BATTERY HEALTH — returns the MAIN supply voltage in mV.
 *
 * Priority:
 *  a) Params["66"]   — vehicle/generator battery in V → × 1000 → mV
 *  b) PowerVolt column — dedicated external supply voltage field in mV
 *     (covers 12V systems: 9000–18000 and 24V systems: up to 30000)
 *  c) Battery column — only when it reads in the 9–30 V range (9000–30000 mV),
 *     indicating the device is reporting external supply voltage rather than
 *     fuel ADC (fuel ADC devices stay below 5000).
 *
 * BackupBattery (GPS internal Li-Po ~3.7–4.2 V) is intentionally excluded —
 * it is not the generator/vehicle main battery the user cares about.
 *
 * @param {Array} rows - raw tracking rows
 * @returns {number|null} Main battery voltage in mV, or null if not available
 */
function calculateBatteryHealth(rows) {
  if (rows.length === 0) return null;
  const last = rows[rows.length - 1];

  const params = parseParams(last.params);
  const b66 = getParamValue(params, '66');
  if (b66 !== null) return round(b66 * 1000, 0);

  const powerVoltRaw = parseNumeric(last.powerVolt);
  if (powerVoltRaw !== null && powerVoltRaw >= 9000 && powerVoltRaw <= 30000) {
    return round(powerVoltRaw, 0);
  }

  const batRaw = parseNumeric(last.battery);
  if (batRaw !== null && batRaw >= 9000 && batRaw <= 30000) {
    return round(batRaw, 0);
  }

  return null;
}

/**
 * 2. FUEL CONSUMPTION — run-window mass-balance formula.
 *
 *   consumed = max(0, (fuelBeforeFirstRun - fuelAfterLastRun) + totalRefueled)
 *
 * Uses the fuel reading just BEFORE the first ignition-ON moment and just
 * AFTER the last ignition-ON moment. This excludes passive sensor drift that
 * accumulates before the generator starts and after it stops, which would
 * otherwise inflate the reported consumption.
 *
 * Falls back to full-day first/last if no ignition-ON readings exist (e.g.
 * sensor-only vehicles or days with no running activity).
 *
 * @param {Array<{timestamp,fuel,ignition}>} dayFiltered  Day's smoothed series
 * @param {number} totalRefueled  Sum of all confirmed refuel events for the day
 * @returns {number|null}
 */
function calculateFuelConsumption(dayFiltered, totalRefueled, preferredFuelPoints = 0, batteryFallbackPoints = 0) {
  if (!dayFiltered || dayFiltered.length === 0) return null;


  const firstOnIdx = dayFiltered.findIndex((pt) => pt.ignition === 1);
  const lastOnIdx  = (() => {
    for (let i = dayFiltered.length - 1; i >= 0; i--) {
      if (dayFiltered[i].ignition === 1) return i;
    }
    return -1;
  })();

  let firstFuel;
  let lastFuel;

  if (firstOnIdx === -1) {
    // No running periods — full-day span (sensor-only or idle day)
    firstFuel = dayFiltered[0].fuel;
    lastFuel  = dayFiltered[dayFiltered.length - 1].fuel;
  } else {
    // Fuel reading just before the first run starts (or at run start if day begins running)
    firstFuel = firstOnIdx > 0
      ? dayFiltered[firstOnIdx - 1].fuel
      : dayFiltered[firstOnIdx].fuel;

    // Fuel reading at the last ignition-ON moment.
    // Using the point AFTER the last ON reading is unreliable for battery-fallback
    // vehicles: the device battery recharges after the generator stops, raising the
    // Battery ADC and making fuel appear to increase post-run.
    lastFuel = dayFiltered[lastOnIdx].fuel;
  }

  const net = (firstFuel - lastFuel) + (totalRefueled || 0);

  // If net fuel went up significantly (sensor reading device voltage, not fuel ADC),
  // flag as unavailable.
  if (net < -1.0) return null;

  return round(Math.max(0, net), 2);
}

/**
 * 3. TOTAL ENGINE HOURS
 *
 * @param {Array} rows - raw rows (ignition column)
 * @returns {number|null}
 */
function calculateTotalEngineHours(rows) {
  if (rows.length === 0) return null;
  const mins = calculateWorkTime(rows);
  return mins !== null ? round(mins / 60, 2) : null;
}

/**
 * 4. GENERATOR START TIME — first OFF→ON ignition transition.
 *
 * @param {Array} rows - raw rows
 * @returns {string|null} ISO timestamp
 */
function calculateGeneratorStartTime(rows) {
  if (rows.length === 0) return null;
  const transitions = detectIgnitionTransitions(rows);

  // No transitions: phantom carryover day → no real start time.
  if (transitions.length === 0) return null;

  // Use the first interval that meets the minimum-duration threshold.
  // Ignoring sub-threshold blips prevents a 2-second noise event at midnight
  // from being shown as the "start time" of a run that happened at noon.
  const allIntervals = buildOnIntervalsFromIgnition(rows, transitions);
  const filtered = filterPhantomIntervals(allIntervals, transitions);
  const first = filtered.find((iv) => iv.durationMinutes >= MIN_VALID_RUNNING_MINUTES);
  return first ? first.start.toISOString() : null;
}

/**
 * 5. GENERATOR STOP TIME — end of the last qualifying ON interval.
 *
 * @param {Array} rows - raw rows
 * @returns {string|null} ISO timestamp, or null if generator is still running
 */
function calculateGeneratorStopTime(rows) {
  if (rows.length === 0) return null;
  const transitions = detectIgnitionTransitions(rows);
  if (transitions.length === 0) return null;

  const allIntervals = buildOnIntervalsFromIgnition(rows, transitions);
  const filtered = filterPhantomIntervals(allIntervals, transitions);
  const valid = filtered.filter((iv) => iv.durationMinutes >= MIN_VALID_RUNNING_MINUTES);
  if (valid.length === 0) return null;

  const last = valid[valid.length - 1];
  const lastRowMs = new Date(rows[rows.length - 1].timestamp).getTime();
  if (Math.abs(last.end.getTime() - lastRowMs) < 1000) return null;
  return last.end.toISOString();
}

/**
 * 6. GENERATOR RUN INTERVALS — every qualifying ON interval for the day.
 *
 * Returns one entry per run, each with a real stop timestamp and an isOpen
 * flag (true = generator was still ON at the last data row, i.e. no confirmed
 * OFF transition). isOpen + today's date = "Still running"; isOpen on a past
 * date = data ended while running, stop shows the last known time.
 *
 * @param {Array} rows - raw rows
 * @returns {Array<{start:string, stop:string, isOpen:boolean, workMinutes:number}>}
 */
function calculateGeneratorRunIntervals(rows) {
  if (rows.length === 0) return [];
  const transitions = detectIgnitionTransitions(rows);
  const allIntervals = buildOnIntervalsFromIgnition(rows, transitions);
  const filtered   = filterPhantomIntervals(allIntervals, transitions);
  const qualifying = filtered.filter((iv) => iv.durationMinutes >= MIN_VALID_RUNNING_MINUTES);
  if (qualifying.length === 0) return [];

  const lastRowMs = new Date(rows[rows.length - 1].timestamp).getTime();

  return qualifying.map((iv) => ({
    start:       iv.start.toISOString(),
    stop:        iv.end.toISOString(),
    isOpen:      Math.abs(iv.end.getTime() - lastRowMs) < 1000,
    isCarryover: iv.startsAtDayBegin === true, // run inherited from previous day
    workMinutes: round(iv.durationMinutes, 1),
  }));
}

/**
 * 7. WORK TIME — total minutes ignition was ON.
 *
 * @param {Array} rows - raw rows
 * @returns {number|null} minutes (1 decimal)
 */
function calculateWorkTime(rows) {
  if (rows.length === 0) return null;

  const transitions = detectIgnitionTransitions(rows);

  // No transitions: if ignition started ON it is a phantom carryover from the
  // previous day (filterPhantomIntervals removes it). Report 0 so the all-day
  // stuck-ignition signal does not inflate the work-time total.
  if (transitions.length === 0) return 0;

  const allIntervals = buildOnIntervalsFromIgnition(rows, transitions);
  const filtered = filterPhantomIntervals(allIntervals, transitions);
  return round(sumIntervals(filtered, MIN_VALID_RUNNING_MINUTES), 1);
}

/**
 * 7. FINAL FUEL VALUE — most recent calibrated fuel reading.
 *
 * @param {Array<{timestamp,fuel,ignition}>} rawSeries (un-smoothed)
 * @returns {number|null} litres
 */
function getFinalFuelValue(rawSeries) {
  if (rawSeries.length === 0) return null;
  return round(rawSeries[rawSeries.length - 1].fuel, 2);
}

// ═══════════════════════════════════════════════════════════════════════════════
// IGNITION TRANSITION DETECTION
// ═══════════════════════════════════════════════════════════════════════════════

function detectIgnitionTransitions(rows) {
  const transitions = [];
  if (rows.length < 2) return transitions;

  let prev = effectiveIgnition(rows[0]);

  for (let i = 1; i < rows.length; i++) {
    const curr = effectiveIgnition(rows[i]);
    if (curr === null) continue;
    if (prev !== null && curr !== prev) {
      transitions.push({ from: prev, to: curr, timestamp: new Date(rows[i].timestamp), rowIndex: i });
    }
    prev = curr;
  }

  return transitions;
}

function buildOnIntervalsFromIgnition(rows, transitions) {
  const intervals = [];
  const initial = effectiveIgnition(rows[0]);
  let isOn = initial === 1;
  let start = isOn ? new Date(rows[0].timestamp) : null;
  // Track whether this interval started from the inherited day-begin state
  // (no preceding OFF→ON transition seen in this day's data).
  let startsAtDayBegin = isOn;

  for (const t of transitions) {
    if (t.from === 0 && t.to === 1) {
      isOn = true; start = t.timestamp;
      startsAtDayBegin = false; // real ON transition observed in this day
    } else if (t.from === 1 && t.to === 0) {
      if (start !== null) {
        intervals.push({ start, end: t.timestamp, durationMinutes: (t.timestamp - start) / 60000, startsAtDayBegin });
      }
      isOn = false; start = null; startsAtDayBegin = false;
    }
  }

  if (isOn && start !== null) {
    const last = new Date(rows[rows.length - 1].timestamp);
    intervals.push({ start, end: last, durationMinutes: (last - start) / 60000, startsAtDayBegin });
  }

  return intervals;
}

/**
 * Remove phantom "stuck-ignition" intervals: an interval that inherited
 * ignition=1 from a previous day AND had zero transitions during the queried
 * day is almost certainly a stale carry-over signal, not a real run.
 * (Genuine cross-midnight runs that actually stop on this day will have at
 * least one 1→0 transition, so they survive this filter.)
 */
function filterPhantomIntervals(allIntervals, transitions) {
  if (allIntervals.length === 1 && allIntervals[0].startsAtDayBegin && transitions.length === 0) {
    return [];
  }
  return allIntervals;
}

function sumIntervals(intervals, minMinutes) {
  return intervals.reduce((total, iv) => total + (iv.durationMinutes >= minMinutes ? iv.durationMinutes : 0), 0);
}

// ═══════════════════════════════════════════════════════════════════════════════
// NUMERIC HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function parseNumeric(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const n = parseFloat(value.replace(/,/g, ''));
    return Number.isNaN(n) ? null : n;
  }
  if (typeof value === 'number') return Number.isNaN(value) ? null : value;
  return null;
}

function round(value, decimals) {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  const m = Math.pow(10, decimals);
  return Math.round(value * m) / m;
}

function createEmptyAnalytics() {
  return {
    batteryHealth: null,
    fuelConsumption: null,
    totalEngineHours: null,
    fuelRefilled: null,
    fuelTheft: null,
    fuelTheftAt: null,
    generatorStartTime: null,
    generatorStopTime: null,
    workTime: null,
    fuel: null,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// LEGACY / COMPAT HELPERS (kept for backward compat, used by extractFuelSeries)
// ═══════════════════════════════════════════════════════════════════════════════

/** @deprecated Use buildFuelIgnitionSeries instead */
function extractFuelSeries(rows, calibration, fuelSensorKey) {
  const calibrationMaxX = calibration
    ? Math.max(...calibration.map((p) => p.x))
    : Infinity;
  return buildFuelIgnitionSeries(rows, calibration, fuelSensorKey, calibrationMaxX)
    .series.map(({ timestamp, fuel }) => ({ timestamp, value: fuel }));
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = {
  calculateVehicleAnalytics,
  // Exported for unit testing
  parseIgnitionState,
  effectiveIgnition,
  calculateGeneratorRunIntervals,
  parseParams,
  getParamValue,
  parseNumeric,
  applyCalibration,
  resolveFuelCalibration,
  buildFuelIgnitionSeries,
  smoothFuelIgnitionSeries,
  extractFuelSeries,
  detectIgnitionTransitions,
  buildOnIntervalsFromIgnition,
  filterPhantomIntervals,
  sumIntervals,
  // New multi-layer detection exports (for testing)
  detectFuelEvents,
  wasRecentlyRunning,
  isFakeSpike,
  isFakeRise,
  isRecoveryRise,
  isStationaryDropRecovery,
  isDropConfirmedAfterDelay,
  isPostDropRecovery,
  isPostRefuelFallback,
  refuelConsolidation,
};
