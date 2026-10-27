'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { filterTransientFuelSpikes } = require('../src/services/analyticsService');

function points(values) {
  return values.map(([seconds, fuel]) => ({
    timestamp: new Date(Date.UTC(2026, 9, 1) + seconds * 1000),
    fuel,
    ignition: 0,
  }));
}

test('removes brief downward and upward sensor glitches', () => {
  for (const values of [
    [[0, 418.61], [145, 163.61], [146, 399.81]],
    [[0, 351.12], [11, 69.8], [15, 350.37]],
    [[0, 380.62], [0, 626.34], [0.003, 380.62]],
    [[0, 367.47], [4, 499.53], [14.367, 367.47]],
  ]) {
    const input = points(values);
    assert.deepEqual(filterTransientFuelSpikes(input), [input[0], input.at(-1)]);
  }
});

test('keeps sustained drops and refills', () => {
  for (const values of [
    [[0, 400], [10, 200], [80, 200], [100, 400]],
    [[0, 400], [10, 200], [20, 200]],
    [[0, 400], [1, 700], [62, 700], [65, 400]],
    [[0, 400], [1, 700], [5, 410], [8, 400]],
  ]) {
    const input = points(values);
    assert.deepEqual(filterTransientFuelSpikes(input), input);
  }
});
