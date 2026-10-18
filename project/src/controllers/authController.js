'use strict';

/**
 * Auth controller — handles fleet login authentication.
 */

const authRepository = require('../repositories/authRepository');

/**
 * POST /api/auth/login
 * Authenticate fleet user with username and password.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function login(req, res, next) {
  try {
    const { username, password } = req.body;

    // Validate required fields
    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_CREDENTIALS',
          message: 'Username and password are required.',
        },
      });
    }

    // Verify credentials against database
    const user = await authRepository.verifyCredentials(username, password);

    if (!user) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid username or password.',
        },
      });
    }

    // Check if user account is enabled
    if (!user.isEnabled) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCOUNT_DISABLED',
          message: 'Account is disabled. Please contact administrator.',
        },
      });
    }
    console.log('User:', user);

    // Successful login response
    return res.status(200).json({
      success: true,
      message: 'Login successful.',
      data: {
        user: {
          fleetId: user.fleetId,
          username: user.username,
        },
      },
    });
  } catch (err) {
    console.error('[authController] Login error:', err.message);
    next(err);
  }
}

module.exports = {
  login,
};
