'use strict';

/**
 * Admin portal routes (/api/admin/*). Everything except login requires an admin
 * session token. Responses are never cached.
 */

const express = require('express');
const admin = require('../controllers/adminController');
const requireAdmin = require('../middleware/requireAdmin');
const { noCache } = require('../middleware/validate');

const router = express.Router();

router.use('/admin', noCache);

router.post('/admin/login', admin.login);

router.get('/admin/session', requireAdmin, admin.session);
router.get('/admin/overview', requireAdmin, admin.overview);

router.get('/admin/fleets/:fleetId', requireAdmin, admin.getFleet);
router.get('/admin/fleets/:fleetId/temperatures', requireAdmin, admin.liveTemperatures);
router.put('/admin/fleets/:fleetId', requireAdmin, admin.saveFleet);
router.delete('/admin/fleets/:fleetId', requireAdmin, admin.deleteFleet);
router.post('/admin/fleets/:fleetId/test-email', requireAdmin, admin.sendTestEmail);

router.get('/admin/history', requireAdmin, admin.history);
router.get('/admin/audit', requireAdmin, admin.audit);

module.exports = router;
