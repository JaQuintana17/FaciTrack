const express = require('express');
const router = express.Router();
const NotificationController = require('../controllers/NotificationController');

router.post('/mark-all-read', NotificationController.markAllRead);

router.post('/:id/mark-read', NotificationController.markReadById);

router.delete('/read', NotificationController.clearRead);

router.get('/more', NotificationController.loadMore);

router.get('/stream', NotificationController.stream);

// The stream's stand-in where a connection cannot be held open.
router.get('/poll', NotificationController.pollNotifications);

// ── Web Push (PWA device notifications) ──
router.get('/push/public-key', NotificationController.getPushPublicKey);
router.post('/push/subscribe', NotificationController.subscribePush);
router.delete('/push/subscribe', NotificationController.unsubscribePush);
router.post('/push/test', NotificationController.testPush);


module.exports = router;
