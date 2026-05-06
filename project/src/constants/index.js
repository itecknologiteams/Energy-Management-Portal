'use strict';

/**
 * Domain constants for fleet fuel analytics.
 * Thresholds and flags will be refined in Part 5 after query analysis.
 */

// ─── Thresholds ───────────────────────────────────────────────────────────────

// Minimum fuel-level rise (L) to be classified as a refill event.
// Raised from 10 → 20 to eliminate ADC sensor upward-spike false refills.
// Actual top-ups are typically 20 L+ (one full container or more).
const FUEL_REFILL_MIN_CHANGE = 20;

// Minimum fuel-level drop (L) to be classified as a theft / abnormal-loss event.
// Raised from 10 → 25 to eliminate ADC sensor offset-jump false positives (10–20 L).
// Real thefts involve physically removing ≥ 25 L; sensor noise stays below this.
const FUEL_THEFT_MIN_CHANGE = 25;

// Trips shorter than this (minutes) are ignored as noise / micro-stops
const MIN_VALID_RUNNING_MINUTES = 2;

// ─── Database Table Names (from Part 2 discovery) ───────────────────────────

// CRM Database tables
const CRM_DB_NAME = 'CRM_REMOTE';
const CRM_FLEET_VEHICLES_TABLE = 'ERP_Tracking.dbo.FleetVehicles';
const CRM_VEHICLES_TABLE = 'ERP_Tracking.dbo.Vehicles'; // Main vehicles table with VEH_REG
const CRM_SENSOR_MAPPING_TABLE = 'ERP_Tracking.dbo.VehicleSensors'; // In CRM DB, not Tracking
const CRM_FLEET_LOGIN_TABLE = 'ERP_Tracking.dbo.FleetLogin'; // Fleet login credentials table

// Tracking Database tables
const TRACKING_DATA_TABLE_PREFIX = 'TrackData';

// ─── Tracking Table Column Names (from Part 2 discovery) ──────────────────────
// CONFIRMED: Tracking table has dedicated columns for common sensors

const TRACKING_VEHICLE_COLUMN = 'V_Id';
const TRACKING_TIMESTAMP_COLUMN = 'ServerTime';
const TRACKING_PARAMS_COLUMN = 'Params';

// Dedicated sensor columns (not in params)
const TRACKING_BATTERY_COLUMN = 'Battery';
const TRACKING_BACKUP_BATTERY_COLUMN = 'BackupBattery';
const TRACKING_POWER_VOLT_COLUMN = 'PowerVolt';
const TRACKING_FUEL_COLUMN = 'FuelLevel';
const TRACKING_IGNITION_COLUMN = 'Ignition';
const TRACKING_ENGINE_CUT_COLUMN = 'EngineCut';

// ─── Sensor Key Mapping (ioXXX param keys from TrackData params column) ─────
// These map the "param" column value from VehicleSensors to the ioXXX key in TrackData
// Format in params JSON: "io{NUMBER}": "value"
// UPDATE THESE after confirming exact mappings from VehicleSensors table

const SENSOR_TYPE_FUEL = 'fuel';
const SENSOR_TYPE_BATTERY = 'battery';
const SENSOR_TYPE_ENGINE_HOURS = 'engine_hours';
const SENSOR_TYPE_GENERATOR = 'generator';

// Default sensor key mappings (ioXXX numbers)
// These will be overridden by per-vehicle mappings from VehicleSensors table
const DEFAULT_SENSOR_KEYS = {
  fuel: '327',          // io327 typically contains fuel ADC value
  battery: '9',         // io9 typically contains battery percentage
  engineHours: '239',   // io239 typically contains runtime
  generator: '236',     // io236 may contain generator state
};

// ─── Vehicles excluded from the Fuel Level History chart ────────────────────
// These vehicles have VehicleSensors rows with calibration in the DB, but the
// physical fuel sensor probe is not connected (io9 Params always empty).
// Battery column on these devices carries device supply voltage, not fuel ADC.
// Removing them here avoids a DB schema change while keeping the chart clean.
const NO_FUEL_SENSOR_VEHICLE_IDS = [
  375742, // VEHARI ROAD D/S   — sensor configured but probe not installed
  375957, // INNER BYE PASS D/S — Battery column is 12 V supply, not fuel ADC
];

// ─── Environment & Debugging ────────────────────────────────────────────────

// Enables verbose logging; true in all non-production environments
const DEBUG_MODE = process.env.NODE_ENV !== 'production';

module.exports = {
  FUEL_REFILL_MIN_CHANGE,
  FUEL_THEFT_MIN_CHANGE,
  MIN_VALID_RUNNING_MINUTES,
  CRM_DB_NAME,
  CRM_FLEET_VEHICLES_TABLE,
  CRM_VEHICLES_TABLE,
  CRM_SENSOR_MAPPING_TABLE,
  CRM_FLEET_LOGIN_TABLE,
  TRACKING_DATA_TABLE_PREFIX,
  TRACKING_VEHICLE_COLUMN,
  TRACKING_TIMESTAMP_COLUMN,
  TRACKING_PARAMS_COLUMN,
  TRACKING_BATTERY_COLUMN,
  TRACKING_BACKUP_BATTERY_COLUMN,
  TRACKING_POWER_VOLT_COLUMN,
  TRACKING_FUEL_COLUMN,
  TRACKING_IGNITION_COLUMN,
  TRACKING_ENGINE_CUT_COLUMN,
  SENSOR_TYPE_FUEL,
  SENSOR_TYPE_BATTERY,
  SENSOR_TYPE_ENGINE_HOURS,
  SENSOR_TYPE_GENERATOR,
  DEFAULT_SENSOR_KEYS,
  NO_FUEL_SENSOR_VEHICLE_IDS,
  DEBUG_MODE,
};
