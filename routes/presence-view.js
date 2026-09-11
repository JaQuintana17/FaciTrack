const express = require('express');
const router = express.Router();

const { requireAuth } = require('../middleware/auth');
const PresenceViewController = require('../controllers/PresenceViewController');

/**
 * Live presence for whichever page is asking.
 *
 * Mounted above the per-role routers because every role has a page that shows
 * In/Out, and four copies of this query would be four chances for them to
 * disagree. It is still behind a session: presence is staff data, and the one
 * place it is shown without a login — the lounge board — has its own gated
 * route.
 */
router.get('/presence/faculty.json', requireAuth, PresenceViewController.facultyJson);

module.exports = router;
