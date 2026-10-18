'use strict';

/**
 * Utilities — shared utility modules.
 */

const errors = require('./errors');

module.exports = {
  errors,
  ...errors, // Re-export individual error classes for convenience
};
