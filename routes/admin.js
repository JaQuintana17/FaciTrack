const express = require('express');
const router = express.Router();
const AdminController = require('../controllers/AdminController');

// Router-level middleware: log all admin route requests
router.use((req, res, next) => {
    console.log(`[Admin Router] ${req.method} ${req.originalUrl}`);
    next();
});

// Role is enforced at the /admin mount in app.js

router.get('/dashboard', AdminController.renderDashboard);

// Route for Users management page (faculty)
router.get('/users', AdminController.renderUsersPage);
router.post('/users', AdminController.createUser);
router.put('/users/:publicId',  AdminController.updateUser);
router.delete('/users/:publicId', AdminController.deleteUser);

// Route for Rooms Management page
router.get('/rooms', AdminController.renderRoomsPage);
router.post('/rooms', AdminController.createRoom);
router.put('/rooms/:roomId', AdminController.updateRoom);
router.delete('/rooms/:roomId', AdminController.deleteRoom);

// Consultation Room — every instructor's slots for a week, and the
// system-wide synchronous limit shown alongside them
router.get('/consultation-room', AdminController.renderConsultationRoomPage);
router.get('/consultation-room/slots', AdminController.getConsultationSlots);

// BLE tags — assigning a physical beacon to an instructor
router.get('/beacons', AdminController.renderBeaconsPage);
router.get('/beacons.json', AdminController.getBeaconsJson);
router.patch('/beacons/:id', AdminController.assignBeacon);
router.delete('/beacons/:id', AdminController.removeBeacon);
// Per-room presence threshold, tuned where the live signal readings are visible
router.patch('/rooms/:id/threshold', AdminController.setRoomThreshold);

// System-wide settings the administrator can change without a redeploy
router.get('/settings', AdminController.renderSettingsPage);
router.patch('/settings', AdminController.updateSettings);

// Audit Logs (the sidebar's 'Audit Logs' entry)
router.get('/reports', AdminController.renderReportsPage);

module.exports = router;
