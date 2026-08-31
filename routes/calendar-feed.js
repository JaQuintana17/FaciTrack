const express = require('express');
const router = express.Router();

const CalendarFeedController = require('../controllers/CalendarFeedController');

/**
 * The outbound ICS feed.
 *
 * Mounted OUTSIDE the role guards on purpose: Google's and Apple's calendar
 * fetchers arrive with no session, so this route authenticates on the token in
 * the path instead. Nothing else here is public.
 */
router.get('/feed/:token', CalendarFeedController.serve);

module.exports = router;
