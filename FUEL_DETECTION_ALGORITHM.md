# Fuel Drop, Theft & Refuel Detection Algorithm

This document explains the complete detection pipeline used to distinguish real fuel theft/consumption events from sensor noise, sloshing, and glitches. The logic was originally written in Python (`aysis-latest.py`) and re-implemented here in TypeScript (`fuel-drop-filter.util.ts`, `fuel-consumption.service.ts`).

---

## Table of Contents

- [Overview](#overview)
- [Constants Reference](#constants-reference)
- [Pipeline Summary](#pipeline-summary)
- [Layer 1 — Median Filter](#layer-1--median-filter)
- [Layer 2 — Event Detection Walk](#layer-2--event-detection-walk)
- [Layer 3a — isFakeSpike (drops)](#layer-3a--isfakespike-drops)
- [Layer 3b — isFakeRise (refuels)](#layer-3b--isfakerise-refuels)
- [Layer 3c — isRecoveryRise](#layer-3c--isrecoveryrise)
- [Layer 3d — isStationaryDropRecovery](#layer-3d--isstationarydroprecovery)
- [Layer 4a — isDropConfirmedAfterDelay](#layer-4a--isdropconfirmedafterdelay)
- [Layer 4b — isPostDropRecovery](#layer-4b--ispostdroprecovery)
- [Layer 4c — isPostRefuelFallback](#layer-4c--ispostrefuelfallback)
- [Refuel Consolidation](#refuel-consolidation)
- [Mass-Balance Consumption Formula](#mass-balance-consumption-formula)
- [Warmup Period](#warmup-period)
- [Data Structure](#data-structure)
- [Decision Flow Diagram](#decision-flow-diagram)

---

## Overview

GPS fuel sensors are noisy. A raw reading can jump ±5 litres between consecutive samples due to:

- **Sloshing** — fuel moving in the tank while the vehicle is turning or braking
- **Sensor jitter** — ADC noise, interference
- **Glitches** — momentary spikes or dips caused by bad connections or power fluctuations

The goal is to produce a list of **confirmed drop events** (real consumption or theft) and **confirmed refuel events** from a raw sequence of timestamped fuel readings, while suppressing all the above false positives.

---

## Constants Reference

| Constant | Value | Description |
|---|---|---|
| `FUEL_MEDIAN_SAMPLES` | 5 | Backward-looking median filter window size |
| `DROP_ALERT_THRESHOLD` | 8.0 L | Minimum drop size to investigate as a potential theft/alert |
| `RISE_THRESHOLD` | 8.0 L | Minimum rise size to count as a refuel |
| `NOISE_THRESHOLD` | 0.5 L | Changes smaller than this are completely ignored |
| `SPIKE_WINDOW_MINUTES` | 7 min | Half-width of the ±7 min fake-spike analysis window |
| `DROP_GATING_MAX_SPEED_KMH` | 10.0 km/h | Speed above which the vehicle is considered "moving" |
| `RISE_GATING_MAX_SPEED_KMH` | 10.0 km/h | Same for refuel detection |
| `POST_DROP_VERIFY_EPS_LITERS` | 1.5 L | Fuel recovery tolerance in post-drop window |
| `POST_REFUEL_VERIFY_EPS_LITERS` | 8.0 L | Fuel fallback tolerance in post-refuel window |
| `RISE_RECOVERY_EPS_LITERS` | 2.0 L | Tolerance in recovery-rise detection |
| `RISE_RECOVERY_LOOKBACK_MINUTES` | 7 min | Lookback for recovery-rise check |
| `REFUEL_CONSOLIDATION_MINUTES` | 15 min | How long to track rising fuel to find true peak |
| `MAX_SINGLE_READING_DROP` | 2.0 L | Single-reading drops above this are flagged as sensor jumps |
| `WARMUP_HOURS` | 2 h | Extra history fetched before query window to warm the filter |

---

## Pipeline Summary

```
Raw DB readings (timestamped fuel + speed values)
         │
         ▼
[Layer 1]  Causal Median Filter          Remove per-sample noise
         │
         ▼
[Layer 2]  Sequential Walk               Detect candidate drops & rises
         │
         ├─── DROP ≥ 8L ──────────────────────────────────────────────┐
         │                                                             │
         ▼                                                             │
[Layer 4a] isDropConfirmedAfterDelay     Still low after ~80s?        │
         │                                                             │
         ▼                                                             │
[Layer 3a] isFakeSpike                   Pattern check in ±7min window│
         │                                                             │
         ▼                                                             │
[Layer 4b] isPostDropRecovery            Recovered in the 7-14min window?
         │                                                             │
         ▼                                                             │
      isConfirmedDrop = true/false  ◄──────────────────────────────────┘
         │
         ├─── RISE ≥ 8L ──────────────────────────────────────────────┐
         │                                                             │
         ▼                                                             │
[Layer 3b] isFakeRise                    Pattern check in ±7min window│
         │                                                             │
         ▼                                                             │
[Layer 3c] isRecoveryRise                Was fuel already near peak?  │
         │                                                             │
         ▼                                                             │
[Layer 3d] isStationaryDropRecovery      Sensor glitch while parked?  │
         │                                                             │
         ▼                                                             │
[Layer 4c] isPostRefuelFallback          Fell back after consolidation?
         │                                                             │
         ▼                                                             │
      isConfirmedRefuel = true/false  ◄──────────────────────────────-┘
         │
         ▼
Mass-balance formula → final consumed / refueled totals
```

---

## Layer 1 — Median Filter

**File:** `fuel-drop-filter.util.ts` → `applyMedianFilter()`

### What it does

Replaces each reading's fuel value with the **median of the last N readings** (backward-only, causal). This eliminates single-sample spikes while preserving real step changes.

### Why causal (backward-only)?

A centered window (using both past and future readings) would "see" a refuel before it happens, shifting event timestamps earlier. A causal window only uses data that would have been available at that moment — matching what a real-time system would do.

### Algorithm

```
for i in range(len(readings)):
    window = readings[max(0, i - N + 1) : i + 1]   # at most N readings ending at i
    fuel_values = sorted([r.fuel for r in window])
    readings[i].fuel = fuel_values[len(fuel_values) // 2]  # median
```

### Example (N=5)

| Index | Raw fuel | Window | Median output |
|---|---|---|---|
| 0 | 200 | [200] | 200 |
| 1 | 198 | [200, 198] | 199 |
| 2 | 250 | [200, 198, 250] | 200 |  ← spike suppressed |
| 3 | 199 | [200, 198, 250, 199] | 199.5 |
| 4 | 197 | [200, 198, 250, 199, 197] | 199 |

> **Important:** Run median filter on RAW readings first. The filtered array is used for event detection. The RAW array is also kept and passed separately to `isFakeSpike` / `isFakeRise` for the ±7min window checks.

---

## Layer 2 — Event Detection Walk

**File:** `fuel-consumption.service.ts` → `analyzeRows()`

Walk the **filtered** readings sequentially. For each pair of consecutive readings, compute:

```
delta = current_fuel - prev_fuel
```

### Case 1: Noise (|delta| < 0.5 L)
Ignore completely.

### Case 2: Small drop (0.5 ≤ |delta| < 8 L, delta negative)
Record as a small consumption drop. Not an alert. Include in mileage consumption sum unless `|delta| > MAX_SINGLE_READING_DROP` (2 L), in which case flag as `isSensorJump = true` and exclude from the total.

### Case 3: Large drop (|delta| ≥ 8 L, delta negative)
Candidate theft/significant loss. Run Layers 3 & 4.

1. Start with `baselineFuel = prev.fuel`
2. Scan forward up to `+SPIKE_WINDOW_MINUTES` to find the lowest confirmed fuel level (`verifiedFuel`), stopping early if fuel recovers above `baseline - 8L` or a refuel step is detected
3. `totalConsumed = baselineFuel - verifiedFuel`
4. Run `isDropConfirmedAfterDelay` → `isFakeSpike` → `isPostDropRecovery`
5. `isConfirmedDrop = totalConsumed >= 8L AND NOT fake AND NOT postRecovery`

### Case 4: Rise (delta ≥ 8 L)
Candidate refuel. Run refuel consolidation + Layers 3b/3c/3d/4c.

---

## Layer 3a — isFakeSpike (drops)

**File:** `fuel-drop-filter.util.ts` → `isFakeSpike()`

Takes a **±7 minute window of RAW readings** around the drop timestamp and returns `true` if the drop is likely a sensor glitch.

### Check 1 — Speed veto (movement at drop time)

```
if any reading in (dropAt, dropAt + 2min] has speed > 10 km/h:
    return true  # vehicle moving → sensor sloshing
```

Only the 2-minute window AFTER the drop is checked. Pre-drop movement (vehicle driving to the site) is expected and must NOT veto a real theft event.

### Check 2 — Full recovery

```
if final_fuel >= start_fuel:
    return true  # fuel recovered completely → fake jerk
```

### Check 3 — Near recovery

```
if |final_fuel - start_fuel| <= 8L:
    return true  # fuel nearly recovered → fake
```

### Check 4 — Sub-drop scan (most important)

Scan every consecutive pair in the window for large sub-drops (≥ 8 L drops within the window):

```
found_large_subdrop = False

for j in range(len(readings) - 1):
    delta = readings[j].fuel - readings[j+1].fuel
    if delta >= 8:
        found_large_subdrop = True
        stayed_low = all(
            abs(r.fuel - readings[j].fuel) > 8
            for r in readings[j+1:]
        )
        if stayed_low:
            return False  # at least one sub-drop sustained → REAL drop

# All large sub-drops recovered
if found_large_subdrop:
    return True   # every sub-drop was temporary → fake
else:
    return False  # gradual drop, already handled by checks 1-3 → real
```

**Why this matters:** A single window can contain multiple sub-drops. A driving oscillation (sloshing) might recover, but the actual theft drop later in the same window will stay low. The original Python code only examined the first sub-drop and returned immediately, incorrectly suppressing the theft. This version scans ALL sub-drops and only declares "fake" when every one of them recovered.

---

## Layer 3b — isFakeRise (refuels)

**File:** `fuel-drop-filter.util.ts` → `isFakeRise()`

Inverse of `isFakeSpike`. Returns `true` if an apparent refuel is actually sensor noise.

### Check 1 — Speed veto (movement after rise)

```
if any reading with ts > riseAt has speed > 10 km/h:
    return true  # vehicle drove away immediately → not a refuel stop
```

### Check 2 — Pre-rise motion veto (sloshing on deceleration)

```
if ALL readings at or before riseAt have speed > 0:
    AND at least one post-rise reading has speed = 0:
        return true  # fuel "rose" as vehicle decelerated and sloshed forward
```

A real refuel requires the vehicle to be stopped BEFORE filling begins. If every pre-rise reading shows motion, the "rise" is fuel settling to the front of the tank as the vehicle brakes.

### Check 3 — Fell back to baseline

```
if final_fuel <= start_fuel:
    return true  # rose then fell back → fake
```

### Check 4 — Did not sustain

```
if |final_fuel - start_fuel| <= 8L:
    return true  # not enough net gain → fake
```

### Check 5 — Sub-rise did not stay high

```
for each consecutive pair with delta >= 8L:
    stayed_high = all(
        abs(r.fuel - readings[i].fuel) > 8
        for r in readings[i+1:]
    )
    return not stayed_high  # stayed high → real; fell back → fake
```

---

## Layer 3c — isRecoveryRise

**File:** `fuel-drop-filter.util.ts` → `isRecoveryRise()`

Detects the pattern: fuel was ALREADY near the post-refuel level just before the rise. This means fuel didn't actually increase — the sensor temporarily dipped then recovered.

```
lookback window = [riseAt - 7min, riseAt)
preMax = max fuel in window
preMin = min fuel in window

if preMax >= peakFuel - 2L       # was already near the "post-refuel" level
   AND preMin <= baseline + 2L    # but also dipped temporarily
   AND preMax - preMin >= 8L:     # significant oscillation in the window
    return true  # recovery rise — no actual fuel was added
```

**Guard:** Skip this check if a **confirmed drop** was recorded within the last 60 minutes before this rise. If the vehicle consumed fuel, then refueled, the pre-rise fuel level will naturally be lower than the post-refuel peak — that is a real refuel, not a recovery.

---

## Layer 3d — isStationaryDropRecovery

**File:** `fuel-drop-filter.util.ts` → `isStationaryDropRecovery()`

Catches the "parked sensor glitch → brief trip → recovery" pattern:

1. Vehicle parked at X litres
2. Sensor drops by ≥ 8 L while still parked (both readings have speed = 0)
3. Vehicle makes a short trip
4. After re-parking, sensor reads back at X litres
5. The rise detector sees the gap between the post-glitch low and the recovery as a "refuel"

```
scan backwards up to 90 minutes from riseAt:
    for each consecutive pair (curr, next):
        drop = curr.fuel - next.fuel
        if drop >= 8L
           AND curr.speed = 0
           AND next.speed = 0
           AND curr.fuel >= peakFuel - 2L:   # was at near-full level before the glitch
            return true  # sensor glitch while parked → suppress refuel
```

---

## Layer 4a — isDropConfirmedAfterDelay

**File:** `fuel-drop-filter.util.ts` → `isDropConfirmedAfterDelay()`

Mirrors the Python monitoring script's verify delay: after detecting a drop, the script waits ~80 seconds and re-reads the current fuel. For historical data, the equivalent is checking the next available reading within 10 minutes.

```
verifyRow = first reading with ts > dropAt AND ts <= dropAt + 10min

if no verifyRow:
    return true   # data gap → assume still dropped (conservative)

stillDropped = verifyRow.fuel < baseline AND |baseline - verifyRow.fuel| >= 8L

isMovingWithIgnitionOn = (ignitionOn = true) AND (speed > 10 km/h)
vehicleStationary = NOT isMovingWithIgnitionOn

return stillDropped AND vehicleStationary
```

If the vehicle is moving with ignition on at the verify time, the drop is considered driving consumption, not theft.

---

## Layer 4b — isPostDropRecovery

**File:** `fuel-drop-filter.util.ts` → `isPostDropRecovery()`

After the ±7 min fake-spike window, check the **next window** (+7 to +14 min from drop) to see if the fuel snapped back. This catches slower-recovering sensor glitches that `isFakeSpike` missed.

```
postWindow = readings in (dropAt + 7min, dropAt + 14min]
if no readings in window: return false  # assume real (conservative)

lastPostFuel = postWindow[-1].fuel
return lastPostFuel >= baseline - 1.5L   # recovered within 1.5L → fake
```

---

## Layer 4c — isPostRefuelFallback

**File:** `fuel-drop-filter.util.ts` → `isPostRefuelFallback()`

After the refuel consolidation window, check if the fuel fell significantly from the detected peak. A real refuel keeps fuel near peak; a fake spike falls back toward the original baseline.

```
postWindow = readings in (consolidationEnd + 7min, consolidationEnd + 14min]

if no readings: extend search to consolidationEnd + 30min

lastPostFuel = postWindow[-1].fuel

if lastPostFuel < peakFuel - 8L:
    return true  # fell back → fake jerk
```

**Override:** If `postFallback = true` but the settled fuel is still ≥ 75% of the added amount above baseline, accept the refuel anyway. The fuel settled lower due to consumption/sensor noise after a genuine fill, not because it was a fake spike.

```
settledFuel = last reading in post-window
retainThreshold = baseline + 0.75 × (peakFuel - baseline)
if settledFuel > retainThreshold:
    postFallback = false  # override — real refuel with minor settling
```

---

## Refuel Consolidation

A physical refuel rarely happens in one clean step. The nozzle is inserted, fuel flows, the driver tops up — multiple rising steps over 5–15 minutes.

After detecting the initial rise (`delta >= 8L`), scan FORWARD up to `REFUEL_CONSOLIDATION_MINUTES` (15 min) to find the true peak:

```
peakFuel = initial_post_rise_fuel
k = i + 1

while reading[k].ts <= riseAt + 15min:
    if reading[k].fuel > peakFuel:
        peakFuel = reading[k].fuel   # still rising → update peak

    elif reading[k].fuel < baseline + 8L:
        if peakFuel - reading[k].fuel > 8L:
            falledBackInConsolidation = true
            break                    # significant drop from peak → stop

    k++

totalAdded = peakFuel - baseline
```

If `falledBackInConsolidation = true` → treat as fake spike without running further checks.

After consolidation, the refuel window bounds are refined by looking at a ±5 min window around `riseAt` and `consolidationEnd` to find the minimum pre-refuel and maximum post-refuel fuel levels, giving more accurate `fuelBefore` / `fuelAfter` values.

---

## Mass-Balance Consumption Formula

**Do not use sum-of-drops for total consumption.** The drop-sum accumulates noise from every small oscillation throughout the day.

The correct formula is:

```
netDrop = firstFuel - lastFuel
actualConsumed = max(0, netDrop + totalRefueled)
```

This is the mass-balance identity:

```
fuel_used = fuel_in_at_start + fuel_added - fuel_remaining
          = firstFuel + refueled - lastFuel
          = (firstFuel - lastFuel) + refueled
          = netDrop + refueled
```

Taking `max(0, ...)` handles the edge case where a vehicle was refueled more than it consumed (net gain), which would otherwise show negative consumption.

This formula is used for both the dashboard total and the per-vehicle cost calculation:

```
estimatedCost = actualConsumed × pricePerLiter
```

---

## Warmup Period

The causal median filter needs N-1 readings before the query window to produce accurate output for the first readings in that window. Without warmup:

- Readings at the start of the window have an incomplete 5-sample window
- The same physical refuel event appears different depending on what `from` date you use
- "This Week" and "This Month" disagree on the same events

**Fix:** Always fetch `WARMUP_HOURS` (2 h) of data BEFORE the requested `from` date. Run the median filter over the full extended dataset. Then filter events to only return those within `[from, to]`.

```
warmupFrom = from - 2h
allRows = fetchRows(imei, warmupFrom, to)
filteredReadings = applyMedianFilter(allRows)

# Only report events that fall within the actual requested range
drops  = [d for d in allDrops  if d.at >= from]
refuels = [r for r in allRefuels if r.at >= from]
```

---

## Data Structure

Each reading passed through the pipeline:

```typescript
interface FuelReading {
  ts: Date;           // timestamp
  fuel: number;       // fuel level in litres (after calibration)
  speed?: number;     // vehicle speed in km/h (from GPS)
  ignitionOn?: boolean; // true = key on, false = key off
}
```

Output drop event:

```typescript
interface DropEvent {
  at: string;             // ISO timestamp of drop start
  fuelBefore: number;     // baseline fuel level
  fuelAfter: number;      // fuel level after drop
  consumed: number;       // fuelBefore - fuelAfter
  isSensorJump: boolean;  // single-reading drop > 2L (exclude from totals)
  isConfirmedDrop: boolean; // passed all 4 layers → real theft/loss
}
```

Output refuel event:

```typescript
interface RefuelEvent {
  at: string;       // ISO timestamp of refuel start
  fuelBefore: number;
  fuelAfter: number;
  added: number;    // fuelAfter - fuelBefore
}
```

---

## Decision Flow Diagram

### Drop path

```
delta < -8L (large drop detected)
    │
    ├── isDropConfirmedAfterDelay?
    │       NO  → isConfirmedDrop = false
    │
    ├── isFakeSpike?
    │       YES → isConfirmedDrop = false
    │
    ├── isPostDropRecovery?
    │       YES → isConfirmedDrop = false
    │
    └── totalConsumed >= 8L?
            YES → isConfirmedDrop = true  ← ALERT: theft / significant loss
            NO  → isConfirmedDrop = false
```

### Rise path

```
delta >= 8L (large rise detected)
    │
    ├── falledBackInConsolidation?
    │       YES → suppress (fake spike in consolidation window)
    │
    ├── isFakeRise?
    │       YES → suppress
    │
    ├── isRecoveryRise?      (skip if confirmed drop in last 60 min)
    │       YES → suppress
    │
    ├── isStationaryDropRecovery?
    │       YES → suppress
    │
    ├── isPostRefuelFallback?
    │       YES → check 75% retention override
    │               PASSES override → accept refuel
    │               FAILS override  → suppress
    │
    └── accept as confirmed refuel  ← EVENT: refuel recorded
```

---

## Implementation Notes for Other Projects

1. **Keep raw and filtered arrays separate.** The filtered array drives event detection; the raw array is used for `isFakeSpike` / `isFakeRise` window checks. Mixing them causes the filter to mask the very oscillations the spike detector needs to see.

2. **Always include a warmup period** when querying historical data. 2 hours is sufficient for a 5-sample filter with 1–2 min data cadence.

3. **Tune constants to your sensor.** The values above were tuned for a capacitive fuel sensor with ±5L oscillation. A more stable sensor can use tighter thresholds (e.g., `DROP_ALERT_THRESHOLD = 5L`). A noisier sensor may need a wider `POST_REFUEL_VERIFY_EPS_LITERS`.

4. **Speed data is essential.** Without speed, you cannot apply the movement veto and will get false positives from sloshing during cornering and braking. If your data source does not include speed, disable the speed checks and increase `SPIKE_WINDOW_MINUTES` to compensate.

5. **The 75% retention override** for `isPostRefuelFallback` is specific to vehicles with idling engines after refueling. If your vehicles always shut off after refueling, you can remove this override and use a tighter epsilon.
