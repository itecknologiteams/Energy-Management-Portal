'use strict';

/**
 * Repositories — database access layer.
 */

const fleetRepository = require('./fleetRepository');
const sensorRepository = require('./sensorRepository');
const trackingRepository = require('./trackingRepository');

module.exports = {
  fleetRepository,
  sensorRepository,
  trackingRepository,
};
