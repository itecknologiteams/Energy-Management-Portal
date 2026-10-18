'use strict';

/**
 * Sensor mapper — translates database mapping rows into structured sensor key objects.
 * The params column in TrackData uses "ioXXX" format where XXX is a number.
 */

const {
  SENSOR_TYPE_FUEL,
  SENSOR_TYPE_BATTERY,
  SENSOR_TYPE_ENGINE_HOURS,
  SENSOR_TYPE_GENERATOR,
  DEFAULT_SENSOR_KEYS,
} = require('../constants');

/**
 * Parse calibration JSON from VehicleSensors.Calibration column.
 * Calibration data is an array of x/y points mapping raw values to real units.
 *
 * @param {string|null} calibrationJson — JSON string from Calibration column
 * @returns {Array<{x: number, y: number}>|null} Parsed calibration points
 */
function parseCalibration(calibrationJson) {
  if (!calibrationJson) return null;

  try {
    const parsed = JSON.parse(calibrationJson);
    if (Array.isArray(parsed)) {
      return parsed.map((point) => ({
        x: parseFloat(point.x),
        y: parseFloat(point.y),
      }));
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Determine sensor type based on the Name column and param name.
 *
 * @param {string} sensorName — value from Name column (e.g., "Fuel", "Battery")
 * @param {string} paramName — value from param column (e.g., "fuel1", "fuel2")
 * @returns {string|null} Sensor type constant or null
 */
function detectSensorType(sensorName, paramName) {
  const normalizedName = (sensorName || '').toLowerCase();
  const normalizedParam = (paramName || '').toLowerCase();

  if (normalizedName.includes('fuel') || normalizedParam.includes('fuel')) {
    return SENSOR_TYPE_FUEL;
  }
  if (normalizedName.includes('battery') || normalizedParam.includes('battery')) {
    return SENSOR_TYPE_BATTERY;
  }
  if (
    normalizedName.includes('engine') ||
    normalizedName.includes('runtime') ||
    normalizedName.includes('hours') ||
    normalizedParam.includes('engine') ||
    normalizedParam.includes('hour')
  ) {
    return SENSOR_TYPE_ENGINE_HOURS;
  }
  if (
    normalizedName.includes('generator') ||
    normalizedName.includes('gen') ||
    normalizedParam.includes('gen')
  ) {
    return SENSOR_TYPE_GENERATOR;
  }

  return null;
}

/**
 * Extract the ioXXX key number from various formats.
 * The TrackData params column uses format: "io327": "value"
 * The param column in VehicleSensors might store just the number or full key.
 *
 * @param {string|number|null} paramValue — value from param column or mapping
 * @returns {string|null} The numeric key (e.g., "327") or null
 */
function extractSensorKey(paramValue) {
  if (!paramValue) return null;

  const str = String(paramValue).trim();

  // Already just a number
  if (/^\d+$/.test(str)) {
    return str;
  }

  // Format like "io327" or "IO327"
  const ioMatch = str.match(/^io(\d+)$/i);
  if (ioMatch) {
    return ioMatch[1];
  }

  // Format like "fuel1_327" or similar with number suffix
  const suffixMatch = str.match(/_(\d+)$/);
  if (suffixMatch) {
    return suffixMatch[1];
  }

  // Try to extract any number
  const anyNumber = str.match(/(\d+)/);
  if (anyNumber) {
    return anyNumber[1];
  }

  return null;
}

/**
 * Resolve sensor mappings from database rows into a structured object.
 * Handles multiple sensors per vehicle (e.g., fuel1, fuel2 for dual tanks).
 *
 * @param {Object[]} mappingRows — rows from VehicleSensors table
 * @returns {Object} Resolved sensor keys with calibration data
 */
function resolveSensorKeys(mappingRows) {
  const result = {
    fuelKeys: [],
    batteryKeys: [],
    engineHoursKeys: [],
    generatorKeys: [],
    unknown: [],
    byParam: {}, // Map of param name -> full details
  };

  // If no mappings found, return default keys from constants
  if (!mappingRows || mappingRows.length === 0) {
    return {
      ...result,
      fuelKeys: [DEFAULT_SENSOR_KEYS.fuel],
      batteryKeys: [DEFAULT_SENSOR_KEYS.battery],
      engineHoursKeys: [DEFAULT_SENSOR_KEYS.engineHours],
      generatorKeys: [DEFAULT_SENSOR_KEYS.generator],
      isDefault: true,
    };
  }

  for (const row of mappingRows) {
    const sensorType = detectSensorType(row.Name, row.param);
    const sensorKey = extractSensorKey(row.param);

    const sensorInfo = {
      vehicleId: row.VehicleId,
      name: row.Name,
      param: row.param,
      sensorKey,
      unit: row.Unit,
      calibration: parseCalibration(row.Calibration),
      min: row.Min,
      max: row.Max,
      formula: row.Formula,
      ioKey: sensorKey ? `io${sensorKey}` : null,
    };

    result.byParam[row.param] = sensorInfo;

    if (sensorType === SENSOR_TYPE_FUEL && sensorKey) {
      result.fuelKeys.push(sensorKey);
    } else if (sensorType === SENSOR_TYPE_BATTERY && sensorKey) {
      result.batteryKeys.push(sensorKey);
    } else if (sensorType === SENSOR_TYPE_ENGINE_HOURS && sensorKey) {
      result.engineHoursKeys.push(sensorKey);
    } else if (sensorType === SENSOR_TYPE_GENERATOR && sensorKey) {
      result.generatorKeys.push(sensorKey);
    } else {
      result.unknown.push(sensorInfo);
    }
  }

  return result;
}

/**
 * Get the primary sensor key for a given type.
 * Returns first key in the array, or default if none found.
 *
 * @param {Object} resolvedKeys — result from resolveSensorKeys()
 * @param {string} sensorType — 'fuel', 'battery', 'engineHours', 'generator'
 * @returns {string|null} Primary sensor key or null
 */
function getPrimaryKey(resolvedKeys, sensorType) {
  const keyArray = resolvedKeys[`${sensorType}Keys`];
  if (keyArray && keyArray.length > 0) {
    return keyArray[0];
  }
  return DEFAULT_SENSOR_KEYS[sensorType] || null;
}

module.exports = {
  resolveSensorKeys,
  getPrimaryKey,
  extractSensorKey,
  parseCalibration,
  detectSensorType,
};
