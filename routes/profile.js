const express = require('express');
const multer = require('multer');
const router = express.Router();

const { requireAuth } = require('../middleware/auth');
const ProfileController = require('../controllers/ProfileController');

// Held in memory because sharp re-encodes the image before anything reaches
// disk — writing the original first would mean storing an unvalidated file.
const avatarUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

/** Multer's own errors as JSON, rather than a stack trace through the handler. */
function acceptAvatar(req, res, next) {
    avatarUpload.single('avatar')(req, res, (err) => {
        if (!err) return next();
        const message = err.code === 'LIMIT_FILE_SIZE'
            ? 'That image is larger than 5 MB.'
            : 'That upload could not be read.';
        res.status(400).json({ status: 'error', message });
    });
}

// One endpoint for every role. The sidebar avatar is the same control on the
// instructor, dean, admin and student pages, and keeping three copies of it is
// how this drifted into three different localStorage keys the first time.
router.post('/profile/avatar', requireAuth, acceptAvatar, ProfileController.uploadAvatar);
router.delete('/profile/avatar', requireAuth, ProfileController.removeAvatar);

router.get('/avatars/:file', requireAuth, ProfileController.serve);

module.exports = router;
