'use strict';

/**
 * Auth routes — defines API endpoints for authentication.
 */

const express = require('express');
const authController = require('../controllers/authController');

const router = express.Router();

// ─── Authentication Endpoints ────────────────────────────────────────────────

// POST /api/auth/login — authenticate fleet user
router.post('/auth/login', authController.login);

module.exports = router;
