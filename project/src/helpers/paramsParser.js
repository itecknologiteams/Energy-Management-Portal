'use strict';

/**
 * Params parser — robust parser for the params column from TrackData tables.
 *
 * The params column can contain data in various formats:
 * - JSON: {"io327": "123", "io9": "1"}
 * - Key-value: 327:"123",9:"1",45:"89"
 * - Mixed: io327:123,io9:1
 * - With or without quotes
 *
 * This parser handles all variations defensively.
 */

/**
 * Parse a params string into a plain JavaScript object.
 * Returns an object where keys are sensor numbers (without 'io' prefix)
 * and values are strings.
 *
 * @param {string|null|undefined} paramsStr — Raw params string from database
 * @returns {Object<string, string>} Parsed params object, empty object if input is null/empty
 */
function parseParams(paramsStr) {
  // Defensive: handle null, undefined, or empty input
  if (!paramsStr || typeof paramsStr !== 'string') {
    return {};
  }

  const trimmed = paramsStr.trim();
  if (trimmed === '' || trimmed === '{}') {
    return {};
  }

  // Try multiple parsing strategies
  let result = tryParseAsJson(trimmed);
  if (result) {
    return normalizeKeys(result);
  }

  result = tryParseAsKeyValue(trimmed);
  if (result) {
    return normalizeKeys(result);
  }

  // If all parsing fails, return empty object
  if (DEBUG_MODE) {
    console.warn('[paramsParser] Failed to parse params string:', paramsStr.substring(0, 100));
  }
  return {};
}

/**
 * Attempt to parse as JSON.
 * @param {string} str
 * @returns {Object|null}
 */
function tryParseAsJson(str) {
  // Must start with { to be JSON
  if (!str.startsWith('{')) {
    return null;
  }

  try {
    const parsed = JSON.parse(str);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Parse key:value,key:value format.
 * Handles variations like: io327:123, io327:"123", 327:123
 * @param {string} str
 * @returns {Object|null}
 */
function tryParseAsKeyValue(str) {
  const result = {};

  // Remove surrounding braces if present
  let content = str;
  if (content.startsWith('{') && content.endsWith('}')) {
    content = content.slice(1, -1);
  }

  // Split by comma, but be careful about quoted commas
  // Simple approach: split on comma not inside quotes
  const pairs = splitPairs(content);

  for (const pair of pairs) {
    const keyValue = parsePair(pair.trim());
    if (keyValue) {
      result[keyValue.key] = keyValue.value;
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Split a string into key:value pairs, respecting quoted values.
 * @param {string} str
 * @returns {string[]}
 */
function splitPairs(str) {
  const pairs = [];
  let current = '';
  let inQuotes = false;
  let quoteChar = null;

  for (let i = 0; i < str.length; i++) {
    const char = str[i];

    if (!inQuotes && (char === '"' || char === "'")) {
      inQuotes = true;
      quoteChar = char;
      current += char;
    } else if (inQuotes && char === quoteChar) {
      inQuotes = false;
      quoteChar = null;
      current += char;
    } else if (!inQuotes && char === ',') {
      pairs.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  if (current.trim()) {
    pairs.push(current.trim());
  }

  return pairs;
}

/**
 * Parse a single key:value pair.
 * @param {string} pair
 * @returns {{key: string, value: string}|null}
 */
function parsePair(pair) {
  // Find the first colon (not in quotes)
  let colonIndex = -1;
  let inQuotes = false;
  let quoteChar = null;

  for (let i = 0; i < pair.length; i++) {
    const char = pair[i];

    if (!inQuotes && (char === '"' || char === "'")) {
      inQuotes = true;
      quoteChar = char;
    } else if (inQuotes && char === quoteChar) {
      inQuotes = false;
      quoteChar = null;
    } else if (!inQuotes && char === ':') {
      colonIndex = i;
      break;
    }
  }

  if (colonIndex === -1) {
    return null;
  }

  let key = pair.substring(0, colonIndex).trim();
  let value = pair.substring(colonIndex + 1).trim();

  // Remove quotes from value
  value = stripQuotes(value);

  // Remove quotes from key if present
  key = stripQuotes(key);

  if (!key) {
    return null;
  }

  return { key, value };
}

/**
 * Remove surrounding quotes from a string.
 * @param {string} str
 * @returns {string}
 */
function stripQuotes(str) {
  if ((str.startsWith('"') && str.endsWith('"')) ||
      (str.startsWith("'") && str.endsWith("'"))) {
    return str.slice(1, -1);
  }
  return str;
}

/**
 * Normalize keys to remove 'io' prefix if present.
 * Converts { io327: '123', io9: '1' } → { '327': '123', '9': '1' }
 * Also handles keys that are already numbers.
 *
 * @param {Object} obj
 * @returns {Object<string, string>}
 */
function normalizeKeys(obj) {
  const result = {};

  for (const [key, value] of Object.entries(obj)) {
    const normalizedKey = normalizeKey(key);
    if (normalizedKey !== null) {
      result[normalizedKey] = String(value);
    }
  }

  return result;
}

/**
 * Normalize a single key.
 * Removes 'io' prefix and returns just the numeric part.
 * @param {string} key
 * @returns {string|null}
 */
function normalizeKey(key) {
  if (!key || typeof key !== 'string') {
    return String(key);
  }

  const trimmed = key.trim().toLowerCase();

  // Remove 'io' prefix if present (e.g., io327 → 327)
  if (trimmed.startsWith('io')) {
    const numPart = trimmed.substring(2);
    if (/^\d+$/.test(numPart)) {
      return numPart;
    }
  }

  // If it's already numeric, return as-is
  if (/^\d+$/.test(trimmed)) {
    return trimmed;
  }

  // Return original if it can't be normalized
  return key;
}

/**
 * Safely get a value from parsed params by key.
 * The key should be the numeric sensor ID (e.g., '327', not 'io327').
 *
 * @param {Object} paramsObj — Result from parseParams()
 * @param {string|number} key — Sensor key (e.g., '327' or 327)
 * @returns {string|null} Value as string, or null if not found
 */
function getValue(paramsObj, key) {
  if (!paramsObj || typeof paramsObj !== 'object') {
    return null;
  }

  const keyStr = String(key);

  // Try direct lookup
  if (keyStr in paramsObj) {
    return paramsObj[keyStr];
  }

  // Try with normalized key
  const normalizedKey = normalizeKey(keyStr);
  if (normalizedKey && normalizedKey in paramsObj) {
    return paramsObj[normalizedKey];
  }

  return null;
}

/**
 * Get a numeric value from parsed params.
 * Returns parsed float, or null if not found or not a valid number.
 *
 * @param {Object} paramsObj — Result from parseParams()
 * @param {string|number} key — Sensor key
 * @returns {number|null} Parsed numeric value or null
 */
function getNumericValue(paramsObj, key) {
  const value = getValue(paramsObj, key);

  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = parseFloat(value);

  if (Number.isNaN(parsed)) {
    return null;
  }

  return parsed;
}

/**
 * Get a boolean value from parsed params.
 * Treats "1" as true, "0" as false.
 * Also handles "true", "false", "yes", "no" (case-insensitive).
 *
 * @param {Object} paramsObj — Result from parseParams()
 * @param {string|number} key — Sensor key
 * @returns {boolean|null} Parsed boolean or null if not found
 */
function getBooleanValue(paramsObj, key) {
  const value = getValue(paramsObj, key);

  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).toLowerCase().trim();

  // Explicit true values
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
    return true;
  }

  // Explicit false values
  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
    return false;
  }

  // Try numeric interpretation
  const numeric = parseFloat(normalized);
  if (!Number.isNaN(numeric)) {
    return numeric !== 0;
  }

  return null;
}

// Import DEBUG_MODE for optional logging
const { DEBUG_MODE } = require('../constants');

module.exports = {
  parseParams,
  getValue,
  getNumericValue,
  getBooleanValue,
  normalizeKey, // Exported for testing
};
