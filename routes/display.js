const express = require('express');
const router = express.Router();

const DisplayController = require('../controllers/DisplayController');

/**
 * The Faculty Lounge board.
 *
 * Mounted outside the role guards because a screen on a wall has no account —
 * but it is not open: the panel is only ever shown a pairing code until an
 * admin approves it and says which lounge it belongs to. There is no
 * department in the URL, so there is no address to guess.
 */
router.get('/board.json', DisplayController.boardJson);
// Live presence, so the board does not wait out a poll to change a name.
router.get('/events', DisplayController.events);
router.get('/', DisplayController.renderBoard);

module.exports = router;
