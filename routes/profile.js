const express = require('express');
const multer = require('multer');
const router = express.Router();

const { requireAuth } = require('../middleware/auth');
const ProfileController = require('../controllers/ProfileController');

// Held in memory because sharp re-encodes the image before anything reaches
// disk — writing the original first would mean storing an unvalidated file.
//
// 4 MB, not more: a serverless host (Vercel) rejects a request body over about
// 4.5 MB before the function even runs, so a larger cap would let the upload
// fail with the platform's opaque 413 instead of the message below. sharp
// shrinks whatever arrives to a 256px thumbnail, so the cap only limits the
// source photo, not what is stored.
const AVATAR_MAX_MB = Number(process.env.AVATAR_MAX_MB) || 4;
const avatarUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: AVATAR_MAX_MB * 1024 * 1024, files: 1 },
});

/** Multer's own errors as JSON, rather than a stack trace through the handler. */
function acceptAvatar(req, res, next) {
    avatarUpload.single('avatar')(req, res, (err) => {
        if (!err) return next();
        const message = err.code === 'LIMIT_FILE_SIZE'
            ? `That image is larger than ${AVATAR_MAX_MB} MB. Please choose a smaller photo.`
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
