const express = require('express');
const router = express.Router();

const DeanController = require('../controllers/DeanController');
const MakeupController = require('../controllers/MakeupController');
// Profile, password and notification preferences act on whoever is logged in,
// not on instructors specifically, so the dean reuses them rather than growing
// a second copy that would drift.
const InstructorController = require('../controllers/InstructorController');

// Router-level middleware: log all dean route requests
router.use((req, res, next) => {
    console.log(`[Dean Router] ${req.method} ${req.originalUrl}`);
    next();
});

// ── Pages ──
router.get('/dashboard', DeanController.renderDashboard);
router.get('/faculty',   DeanController.renderFaculty);
router.get('/presence',  DeanController.renderPresence);
router.get('/presence.json', DeanController.getPresenceFeedJson);
router.get('/presence/rows', DeanController.getPresenceRows);
router.get('/reports',   DeanController.renderReports);
router.get('/settings',  DeanController.renderSettings);
router.get('/building',  DeanController.renderBuilding);

// Monitoring — redirects to Faculty (merged page)
router.get('/monitoring', (_req, res) => res.redirect('/dean/faculty'));

// ── Account ──
router.patch('/profile',                InstructorController.updateOwnProfile);
router.patch('/password',               InstructorController.changePassword);
router.patch('/settings/notifications', InstructorController.updateNotificationPrefs);

// ── Make-Up Class Requests ──
// The dean only ever sees their own department; the controller enforces it.
router.get('/makeup/requests',        MakeupController.renderDeanQueue);
router.get('/makeup/document/:docId', MakeupController.downloadDocument);

// Clearing the whole queue re-validates every request on the way through
router.post('/makeup/approve-all', MakeupController.approveAll);

// Two URLs, one decision path, so approve and decline cannot drift apart
router.post('/makeup/:id/approve', (req, res) => {
    req.body.decision = 'approve';
    return MakeupController.decide(req, res);
});
router.post('/makeup/:id/decline', (req, res) => {
    req.body.decision = 'decline';
    req.body.declineReason = req.body.declineReason || req.body.reason;
    return MakeupController.decide(req, res);
});

module.exports = router;
