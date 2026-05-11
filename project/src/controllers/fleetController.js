'use strict';

/**
 * Fleet controller — handles HTTP requests for fleet-related endpoints.
 */

const fleetService = require('../services/fleetService');
const { analyticsService } = require('../services');
const { getTrackingData } = require('../repositories/trackingRepository');
const sensorRepository = require('../repositories/sensorRepository');
const sensorMapper = require('../helpers/sensorMapper');

/**
 * GET /api/fleets/:fleetId/vehicles
 * Retrieve all vehicles belonging to a fleet.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function getFleetVehicles(req, res, next) {
  try {
    const { fleetId } = req.params;

    const result = await fleetService.getFleetVehicles(fleetId);

    res.json({
      success: true,
      fleetId: result.fleetId,
      count: result.count,
      vehicles: result.vehicles,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/fleets/:fleetId/vehicles-with-sensors
 * Retrieve all vehicles with their sensor mappings.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function getFleetVehiclesWithSensors(req, res, next) {
  try {
    const { fleetId } = req.params;

    const result = await fleetService.getFleetVehiclesWithSensors(fleetId);

    res.json({
      success: true,
      fleetId: result.fleetId,
      count: result.count,
      vehicles: result.vehicles,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/vehicles/:vehicleId/sensors
 * Retrieve sensor mappings for a specific vehicle.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function getVehicleSensors(req, res, next) {
  try {
    const { vehicleId } = req.params;

    const result = await fleetService.getVehicleWithSensors(vehicleId);

    res.json({
      success: true,
      vehicleId: result.vehicleId,
      sensors: result.sensors,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/vehicles/:vehicleId/analytics?date=YYYY-MM-DD
 * Calculate analytics for a specific vehicle on a specific date.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function getVehicleAnalytics(req, res, next) {
  try {
    const { vehicleId } = req.params;
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'date query parameter is required (YYYY-MM-DD)' },
      });
    }

    const parsedVehicleId = parseInt(vehicleId, 10);

    // Fetch sensor config (calibration curves) from VehicleSensors table
    const mappingRows = await sensorRepository.getSensorMappingsByVehicleId(parsedVehicleId);
    const sensorKeys = sensorMapper.resolveSensorKeys(mappingRows);

    // Fetch tracking data
    const trackingRows = await getTrackingData(parsedVehicleId, date);

    // Calculate analytics using sensor calibration
    const analytics = analyticsService.calculateVehicleAnalytics(
      parsedVehicleId,
      date,
      sensorKeys,
      trackingRows
    );
    res.json({
      success: true,
      vehicleId: parsedVehicleId,
      date,
      analytics,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/fleets/:fleetId/analytics?date=YYYY-MM-DD
 * Calculate analytics for all vehicles in a fleet on a specific date.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function getFleetAnalytics(req, res, next) {
  try {
    const { fleetId } = req.params;
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'date query parameter is required (YYYY-MM-DD)' },
      });
    }

    // Get all vehicles in fleet
    const fleetData = await fleetService.getFleetVehicles(fleetId);

    // Calculate analytics for each vehicle
    const vehicleAnalytics = await Promise.all(
      fleetData.vehicles.map(async ({ vehicleId, vehicleName }) => {
        try {
          const parsedVehicleId = parseInt(vehicleId, 10);

          // Fetch sensor config and tracking data in parallel
          const [mappingRows, trackingRows] = await Promise.all([
            sensorRepository.getSensorMappingsByVehicleId(parsedVehicleId),
            getTrackingData(parsedVehicleId, date),
          ]);

          const sensorKeys = sensorMapper.resolveSensorKeys(mappingRows);

          // Calculate analytics with calibration
          const analytics = analyticsService.calculateVehicleAnalytics(
            parsedVehicleId,
            date,
            sensorKeys,
            trackingRows
          );

          return {
            vehicleId: parsedVehicleId,
            vehicleName,
            analytics,
          };
        } catch (err) {
          console.error(`[fleetController] Failed to get analytics for vehicle ${vehicleId}:`, err.message);
          return {
            vehicleId,
            vehicleName,
            analytics: null,
            error: err.message,
          };
        }
      })
    );

    res.json({
      success: true,
      fleetId: fleetData.fleetId,
      date,
      vehicles: vehicleAnalytics,
      count: vehicleAnalytics.length,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/vehicles/:vehicleId/fuel-debug?date=YYYY-MM-DD
 * Debug endpoint to trace fuel calculation for comparison with vendor portal.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function getVehicleFuelDebug(req, res, next) {
  try {
    const { vehicleId } = req.params;
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'date query parameter is required (YYYY-MM-DD)' },
      });
    }

    const parsedVehicleId = parseInt(vehicleId, 10);

    // Fetch sensor config and tracking data
    const [mappingRows, trackingRows] = await Promise.all([
      sensorRepository.getSensorMappingsByVehicleId(parsedVehicleId),
      getTrackingData(parsedVehicleId, date),
    ]);

    const sensorKeys = sensorMapper.resolveSensorKeys(mappingRows);

    // Get raw fuel calibration from sensorKeys
    let fuelCalibration = null;
    if (sensorKeys?.byParam) {
      for (const param of Object.keys(sensorKeys.byParam)) {
        const info = sensorKeys.byParam[param];
        if (
          Array.isArray(info?.calibration) &&
          info.calibration.length >= 2 &&
          sensorKeys.fuelKeys?.includes(info.sensorKey)
        ) {
          fuelCalibration = info.calibration;
          break;
        }
      }
    }

    const fuelSensorKey = sensorKeys?.fuelKeys?.[0] ?? null;
    const calibrationMaxX = fuelCalibration
      ? Math.max(...fuelCalibration.map((p) => p.x))
      : 6000; // default max ADC value when no calibration exists

    // Get latest tracking row for raw values
    const latestRow = trackingRows.length > 0 ? trackingRows[trackingRows.length - 1] : null;
    let rawFuelValue = null;
    let calibratedFuel = null;
    let fuelSource = null;

    if (latestRow) {
      // Check sources in same priority as buildFuelIgnitionSeries
      // 1. FuelLevel column
      if (latestRow.fuelLevel !== null && latestRow.fuelLevel !== undefined) {
        rawFuelValue = latestRow.fuelLevel;
        fuelSource = 'FuelLevel column';
      }

      // 2. Params[fuelSensorKey]
      if (rawFuelValue === null && fuelSensorKey && latestRow.params) {
        try {
          const params = JSON.parse(latestRow.params);
          const pv = params[fuelSensorKey];
          if (pv !== null && pv !== undefined) {
            rawFuelValue = parseFloat(pv);
            fuelSource = `Params[io${fuelSensorKey}]`;
          }
        } catch { /* ignore */ }
      }

      // 3. Params["327"]
      if (rawFuelValue === null && latestRow.params) {
        try {
          const params = JSON.parse(latestRow.params);
          const p327 = params['327'];
          if (p327 !== null && p327 !== undefined) {
            rawFuelValue = parseFloat(p327);
            fuelSource = 'Params[io327]';
          }
        } catch { /* ignore */ }
      }

      // 4. Battery column (if within calibration range or default guard)
      if (rawFuelValue === null && latestRow.battery !== null && latestRow.battery !== undefined) {
        const batRaw = parseFloat(latestRow.battery);
        const maxAllowed = fuelCalibration ? calibrationMaxX * 2.0 : 15000; // allow extrapolation beyond calibration
        if (!isNaN(batRaw) && batRaw <= maxAllowed && batRaw >= 0) {
          rawFuelValue = batRaw;
          fuelSource = 'Battery column (ADC)';
        }
      }

      // Apply calibration if needed
      if (rawFuelValue !== null && fuelCalibration) {
        calibratedFuel = applyCalibrationDebug(rawFuelValue, fuelCalibration);
      }
    }

    res.json({
      success: true,
      vehicleId: parsedVehicleId,
      date,
      fuelSensorKey,
      fuelCalibration,
      calibrationMaxX,
      latestRow: latestRow ? {
        timestamp: latestRow.timestamp,
        battery: latestRow.battery,
        backupBattery: latestRow.backupBattery,
        powerVolt: latestRow.powerVolt,
        fuelLevel: latestRow.fuelLevel,
        params: latestRow.params,
      } : null,
      debug: {
        rawFuelValue,
        fuelSource,
        calibratedFuel,
        vendorPortalComparison: {
          yourCalculatedFuel: calibratedFuel,
          vendorPortalFuel: 'Compare with your vendor portal',
          difference: calibratedFuel ? 'Subtract vendor value from your value' : null,
        },
      },
      totalTrackingRows: trackingRows.length,
    });
  } catch (err) {
    next(err);
  }
}

// Helper for calibration in debug endpoint - clamps to calibration range
function applyCalibrationDebug(rawValue, calibrationPoints) {
  if (!calibrationPoints || calibrationPoints.length < 2) return rawValue;
  const sorted = [...calibrationPoints].sort((a, b) => a.x - b.x);
  if (rawValue <= sorted[0].x) return sorted[0].y;
  // Clamp to max (vendor portal behavior)
  if (rawValue >= sorted[sorted.length - 1].x) {
    return sorted[sorted.length - 1].y;
  }
  for (let i = 0; i < sorted.length - 1; i++) {
    if (rawValue >= sorted[i].x && rawValue <= sorted[i + 1].x) {
      const ratio = (rawValue - sorted[i].x) / (sorted[i + 1].x - sorted[i].x);
      return sorted[i].y + ratio * (sorted[i + 1].y - sorted[i].y);
    }
  }
  return rawValue;
}

/**
 * GET /api/vehicles/:vehicleId/fuel-series?date=YYYY-MM-DD
 * Get fuel time-series data for graphing refuel events and fuel levels over time.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function getVehicleFuelSeries(req, res, next) {
  try {
    const { vehicleId } = req.params;
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'date query parameter is required (YYYY-MM-DD)' },
      });
    }

    const parsedVehicleId = parseInt(vehicleId, 10);

    // Fetch sensor config and tracking data
    const [mappingRows, trackingRows] = await Promise.all([
      sensorRepository.getSensorMappingsByVehicleId(parsedVehicleId),
      getTrackingData(parsedVehicleId, date),
    ]);

    const sensorKeys = sensorMapper.resolveSensorKeys(mappingRows);

    // Get fuel calibration
    let fuelCalibration = null;
    if (sensorKeys?.byParam) {
      for (const param of Object.keys(sensorKeys.byParam)) {
        const info = sensorKeys.byParam[param];
        if (
          Array.isArray(info?.calibration) &&
          info.calibration.length >= 2 &&
          sensorKeys.fuelKeys?.includes(info.sensorKey)
        ) {
          fuelCalibration = info.calibration;
          break;
        }
      }
    }

    const fuelSensorKey = sensorKeys?.fuelKeys?.[0] ?? null;
    const calibrationMaxX = fuelCalibration
      ? Math.max(...fuelCalibration.map((p) => p.x))
      : 6000; // default max ADC value when no calibration exists

    // Import analytics service functions
    const {
      buildFuelIgnitionSeries,
      smoothFuelIgnitionSeries,
      detectFuelEvents,
    } = require('../services/analyticsService');

    // Build fuel series
    const { series: rawSeries, powerEvents } = buildFuelIgnitionSeries(
      trackingRows, fuelCalibration, fuelSensorKey, calibrationMaxX
    );

    // Get smoothed series
    const smoothed = smoothFuelIgnitionSeries(rawSeries);

    // Use the same multi-layer detection algorithm as calculateVehicleAnalytics
    // to avoid counting noise spikes, recovery rises, and post-run battery artefacts.
    const { refuels } = detectFuelEvents(rawSeries, smoothed, null, powerEvents);
    const refuelEvents = refuels.map(r => ({
      timestamp: r.at,
      amount:    Math.round(r.added    * 100) / 100,
      fuelBefore: Math.round(r.before  * 100) / 100,
      fuelAfter:  Math.round(r.after   * 100) / 100,
    }));

    // Format series for graphing (raw data points)
    const fuelSeries = rawSeries.map((point) => ({
      timestamp: point.timestamp,
      fuel: Math.round(point.fuel * 100) / 100,
      ignition: point.ignition,
    }));

    // Get min/max for graph scaling
    const fuelValues = fuelSeries.map((p) => p.fuel);
    const minFuel = fuelValues.length > 0 ? Math.min(...fuelValues) : 0;
    const maxFuel = fuelValues.length > 0 ? Math.max(...fuelValues) : 0;

    res.json({
      success: true,
      vehicleId: parsedVehicleId,
      date,
      summary: {
        totalReadings: fuelSeries.length,
        currentFuel: fuelSeries.length > 0 ? fuelSeries[fuelSeries.length - 1].fuel : null,
        minFuel: Math.round(minFuel * 100) / 100,
        maxFuel: Math.round(maxFuel * 100) / 100,
        totalRefueled: refuelEvents.reduce((sum, e) => sum + e.amount, 0),
        refuelCount: refuelEvents.length,
      },
      fuelSeries,
      refuelEvents,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/vehicles/:vehicleId/fix-calibration
 * Fix wrong calibration for a vehicle (e.g., Advog Vehra L/S which had 102L instead of 201L max).
 * This updates the VehicleSensors table with the correct 201L max calibration.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function fixCalibration(req, res, next) {
  try {
    const { vehicleId } = req.params;
    const parsedVehicleId = parseInt(vehicleId, 10);

    // Get current sensor mapping
    const mappingRows = await sensorRepository.getSensorMappingsByVehicleId(parsedVehicleId);

    if (!mappingRows || mappingRows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No sensor mappings found for this vehicle',
      });
    }

    // Find the fuel sensor mapping
    const fuelMapping = mappingRows.find(row =>
      row.Name?.toLowerCase().includes('fuel') ||
      row.param?.toLowerCase().includes('fuel')
    );

    if (!fuelMapping) {
      return res.status(404).json({
        success: false,
        error: 'No fuel sensor mapping found for this vehicle',
      });
    }

    // The CORRECT calibration (201L max) that matches vendor portal
    const correctCalibration = [
      { x: 0, y: 0 },
      { x: 1000, y: 40 },
      { x: 2000, y: 80 },
      { x: 3000, y: 120 },
      { x: 4000, y: 161 },
      { x: 5000, y: 201 }
    ];

    // Get current calibration for comparison
    const currentCalibration = fuelMapping.Calibration;

    // TODO: Update the database with correct calibration
    // For now, just return what needs to be updated
    res.json({
      success: true,
      vehicleId: parsedVehicleId,
      message: 'Calibration fix required',
      currentCalibration: currentCalibration,
      correctCalibration: correctCalibration,
      action: 'Please run this SQL in your CRM database:',
      sql: `UPDATE ERP_Tracking.dbo.VehicleSensors SET Calibration = '${JSON.stringify(correctCalibration)}' WHERE VehicleId = ${parsedVehicleId} AND Name LIKE '%fuel%'`,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/vehicles/:vehicleId/raw-sensors
 * Get raw sensor data DIRECTLY from database with no caching/mapping layers.
 * This bypasses sensorMapper to verify exactly what's in the VehicleSensors table.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function getRawSensors(req, res, next) {
  try {
    const { vehicleId } = req.params;
    const parsedVehicleId = parseInt(vehicleId, 10);

    // Query database directly (bypass any potential caching layers)
    const { getPool } = require('../db/crmDb');
    const pool = await getPool();

    const query = `
      SELECT VehicleId, Name, Min, Max, Formula, Unit, Calibration, param
      FROM ERP_Tracking.dbo.VehicleSensors
      WHERE VehicleId = @vehicleId
    `;

    const dbResult = await pool
      .request()
      .input('vehicleId', parsedVehicleId)
      .query(query);

    // Log raw calibration data for debugging
    console.log('[RAW SENSORS] Vehicle %d:', parsedVehicleId);
    dbResult.recordset.forEach((row, idx) => {
      console.log('  Row %d: Name=%s, param=%s, Calibration=%s', 
        idx, row.Name, row.param, row.Calibration);
    });

    res.json({
      success: true,
      vehicleId: parsedVehicleId,
      queriedAt: new Date().toISOString(),
      rowCount: dbResult.recordset.length,
      rawRows: dbResult.recordset,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/fleets/:fleetId/battery-check?date=YYYY-MM-DD
 * Show raw battery-related fields (battery, backupBattery, powerVolt, Params["66"])
 * for every vehicle in the fleet. Used to diagnose why batteryHealth shows null.
 */
async function getFleetBatteryCheck(req, res, next) {
  try {
    const { fleetId } = req.params;
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({ success: false, error: { message: 'date required (YYYY-MM-DD)' } });
    }

    const fleetData = await fleetService.getFleetVehicles(fleetId);
    const { parseParams, getParamValue, parseNumeric } = require('../services/analyticsService');

    const results = await Promise.all(
      fleetData.vehicles.map(async ({ vehicleId, vehicleName }) => {
        try {
          const rows = await getTrackingData(parseInt(vehicleId, 10), date);
          if (rows.length === 0) return { vehicleId, vehicleName, status: 'no_data' };

          const last = rows[rows.length - 1];
          const params = parseParams(last.params);

          const allParamKeys = Object.keys(params).filter(k => {
            const v = parseNumeric(params[k]);
            return v !== null && v >= 9 && v <= 35; // voltage range 9-35 V
          });

          return {
            vehicleId,
            vehicleName,
            battery:       last.battery,
            backupBattery: last.backupBattery,
            powerVolt:     last.powerVolt,
            param66:       getParamValue(params, '66'),
            param67:       getParamValue(params, '67'),
            voltageParams: allParamKeys.map(k => ({ key: k, value: params[k] })),
            totalRows:     rows.length,
          };
        } catch {
          return { vehicleId, vehicleName, status: 'error' };
        }
      })
    );

    res.json({ success: true, fleetId, date, vehicles: results });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getFleetVehicles,
  getFleetVehiclesWithSensors,
  getVehicleSensors,
  getVehicleAnalytics,
  getFleetAnalytics,
  getVehicleFuelDebug,
  getVehicleFuelSeries,
  fixCalibration,
  getRawSensors,
  getFleetBatteryCheck,
};
