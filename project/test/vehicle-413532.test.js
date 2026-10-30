'use strict';

/**
 * Regression tests using vehicle 413532 (GENSET-TCM, fleet 2086) exactly as
 * production returned it on 30 Oct 2026:
 *   - VehicleSensors: one "fuel" row, param io270, inverted calibration
 *   - TrackData: FuelLevel = 0 (not NULL), io270 = 9595, io72 = 320
 * Before the fix the portal showed Fuel Level "—" (FuelLevel 0 hid io270) and
 * dropped the last 5 hours of the day (PKT timestamps compared with UTC now).
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveSensorKeys } = require('../src/helpers/sensorMapper');
const {
  calculateVehicleAnalytics,
  buildFuelIgnitionSeries,
  applyCalibration,
  normalizeFuelRaw,
} = require('../src/services/analyticsService');
const { dbClockNow } = require('../src/services/alertService');

// VehicleSensors row, verbatim
const SENSOR_ROW = {
  VehicleId: '413532', Name: 'fuel', Min: null, Max: null, Formula: '', Unit: null, param: 'io270',
  Calibration: '[{"x": "10242", "y": "0"}, {"x": "10028", "y": "100"}, {"x": "9815", "y": "200"}, {"x": "9601", "y": "300"}, {"x": "9388", "y": "400"}, {"x": "9174", "y": "500"}, {"x": "8960", "y": "600"}, {"x": "8747", "y": "700"}, {"x": "8533", "y": "800"}, {"x": "8320", "y": "900"}, {"x": "8106", "y": "1000"}]',
};

// Latest TrackData row, verbatim except the timestamp
const PARAMS = '{"16":11718000,"181":1,"182":0.6,"200":0,"201":0,"21":5,"239":0,"240":0,"241":41004,"25":32,"270":9595,"29":100,"327":0,"463":2335,"483":0,"66":12.319,"67":4.044,"68":0,"69":1,"72":320,"86":65535}';
const row = (timestamp, overrides = {}) => ({
  timestamp, vehicleId: 413532, battery: 12.319, backupBattery: 4044, powerVolt: 12.319,
  fuelLevel: 0, ignition: false, engineCut: null, params: PARAMS, ...overrides,
});

// 9595 lies between (9601, 300 L) and (9388, 400 L)
const EXPECTED_LITRES = 300 + ((9601 - 9595) / (9601 - 9388)) * 100; // 302.8169…

const sensorKeys = resolveSensorKeys([SENSOR_ROW]);
const calibration = sensorKeys.byParam.io270.calibration;
const maxX = Math.max(...calibration.map((p) => p.x));

test('sensor mapping resolves io270 as the fuel sensor', () => {
  assert.deepEqual(sensorKeys.fuelKeys, ['270']);
  assert.equal(calibration.length, 11);
  assert.equal(normalizeFuelRaw(9595, maxX), 9595, 'raw ADC counts are not treated as mV');
});

test('inverted calibration converts 9595 to 302.82 L', () => {
  assert.equal(Math.round(applyCalibration(9595, calibration) * 100) / 100, 302.82);
  assert.equal(applyCalibration(10242, calibration), 0);
  assert.equal(applyCalibration(8106, calibration), 1000);
  assert.equal(applyCalibration(7000, calibration), 1000, 'clamped at full');
});

test('FuelLevel = 0 no longer hides the calibrated sensor', () => {
  const { series } = buildFuelIgnitionSeries([row('2026-10-30T18:52:36.740Z')], calibration, '270', maxX);
  assert.equal(series.length, 1);
  assert.ok(Math.abs(series[0].fuel - EXPECTED_LITRES) < 1e-9);
});

test('a real CAN FuelLevel (> 0) is still used first', () => {
  const { series } = buildFuelIgnitionSeries([row('2026-10-30T18:52:36.740Z', { fuelLevel: 150 })], calibration, '270', maxX);
  assert.equal(series[0].fuel, 150);
});

test('dashboard analytics show the current fuel and temperature', () => {
  const now = dbClockNow().getTime(); // PKT wall clock, same as the DB
  const rows = [
    row(new Date(now - 4 * 3600e3).toISOString(), { params: PARAMS.replace('"72":320', '"72":337') }),
    row(new Date(now - 60e3).toISOString()),
  ];
  const a = calculateVehicleAnalytics(413532, '2026-10-30', sensorKeys, rows);
  assert.equal(a.fuel, 302.82);
  assert.equal(a.temperature, 32, 'latest reading (1 min ago), not the 4-hour-old 33.7 °C');
  assert.equal(a.temperatureAt, rows[1].timestamp);
  assert.equal(a.batteryHealth, 12319);
});

test('rows in the last 5 hours are kept; rows far in the future are dropped', () => {
  const now = dbClockNow().getTime();
  const rows = [
    row(new Date(now - 30e3).toISOString()),                                                      // 30 s ago
    row(new Date(now + 2 * 60e3).toISOString(), { params: PARAMS.replace('"72":320', '"72":330') }), // small clock drift: kept
    row(new Date(now + 3 * 3600e3).toISOString(), { params: PARAMS.replace('"72":320', '"72":999') }), // bad clock: dropped
  ];
  const a = calculateVehicleAnalytics(413532, '2026-10-30', sensorKeys, rows);
  assert.equal(a.temperature, 33);
});
