'use strict';

/**
 * Middleware — Express middleware modules.
 */

const errorHandler = require('./errorHandler');
const requestLogger = require('./requestLogger');
const validate = require('./validate');

module.exports = {
  errorHandler,
  requestLogger,
  ...validate,
};
