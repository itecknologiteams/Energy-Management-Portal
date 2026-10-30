'use strict';

/**
 * Requires a valid admin session token: "Authorization: Bearer <token>".
 * Sets req.admin = { username, expiresAt }.
 */

const { verifyToken, AuthError } = require('../services/adminAuth');

function requireAdmin(req, res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  try {
    req.admin = verifyToken(token);
    next();
  } catch (err) {
    const status = err instanceof AuthError ? err.statusCode : 401;
    res.status(status).json({ success: false, error: { code: 'UNAUTHORIZED', message: err.message || 'Please sign in' } });
  }
}

module.exports = requireAdmin;
