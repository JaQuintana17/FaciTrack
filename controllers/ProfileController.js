const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');
const sharp = require('sharp');
const UserModel = require('../models/UserModel');

/**
 * Profile photos.
 *
 * Files live outside public/ and are handed out by serve() below, the same way
 * make-up documents are — nothing under storage/ is web-reachable by accident.
 * The column stores the finished web path ("/avatars/<uuid>.jpg"), so every
 * existing <img src="<%= ...profilePhoto %>"> keeps working untouched.
 */

const AVATAR_DIR = path.join(__dirname, '..', 'storage', 'uploads', 'avatars');
const WEB_PREFIX = '/avatars/';

// Rendered between 40px and 96px across the app, so 256 covers retina without
// keeping a multi-megabyte camera original to fill a thumbnail.
const AVATAR_SIZE = 256;

// The shape of a name we generated ourselves, and the only shape serve() will
// open — a request can therefore never name a path we did not write.
const STORED_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/;

/** Remove a stored avatar, ignoring anything that is not one of ours. */
async function deleteStored(webPath) {
    if (!webPath || !webPath.startsWith(WEB_PREFIX)) return;
    const name = path.basename(webPath);
    if (!STORED_NAME.test(name)) return;
    // Best effort: a failed delete costs disk space, not correctness.
    await fs.unlink(path.join(AVATAR_DIR, name)).catch(() => {});
}

const ProfileController = {

    async uploadAvatar(req, res) {
        if (!req.file) {
            return res.status(400).json({ status: 'error', message: 'No image was uploaded.' });
        }

        let filename = null;
        try {
            // Decoding IS the validation — a renamed .exe never gets this far, so
            // the check does not rest on a client-supplied MIME type. Re-encoding
            // also drops EXIF, which on phone photos carries GPS coordinates.
            const processed = await sharp(req.file.buffer)
                .rotate()   // apply the EXIF orientation before that tag is discarded
                .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover', position: 'centre' })
                .jpeg({ quality: 82 })
                .toBuffer();

            filename = `${crypto.randomUUID()}.jpg`;
            await fs.mkdir(AVATAR_DIR, { recursive: true });
            await fs.writeFile(path.join(AVATAR_DIR, filename), processed);

            const webPath = WEB_PREFIX + filename;
            const result = await UserModel.updateProfilePicture(req.session.userId, webPath);

            if (!result) {
                // The session outlived the account — do not leave the file behind.
                await deleteStored(webPath);
                return res.status(404).json({ status: 'error', message: 'Account not found.' });
            }

            // Read on every sidebar render. Without this the new photo would show
            // until the next page load and then appear to revert.
            req.session.profilePhoto = webPath;

            await deleteStored(result.previous);

            res.json({ status: 'ok', url: webPath });
        } catch (err) {
            if (filename) await deleteStored(WEB_PREFIX + filename);

            // sharp refuses anything it cannot decode; that is a bad upload
            // rather than a server fault, so answer 400 and say what happened.
            if (/unsupported image|input buffer|input file/i.test(err.message || '')) {
                return res.status(400).json({
                    status: 'error',
                    message: 'That file is not a readable image.',
                });
            }
            console.error('[ProfileController.uploadAvatar]', err);
            res.status(500).json({ status: 'error', message: 'Could not save the photo.' });
        }
    },

    /**
     * Drop the photo and fall back to initials.
     *
     * This is a replacement without the replacement, so it reuses the same
     * model call and the same cleanup. Removing when there is nothing to remove
     * is not an error — the caller wanted no photo, and there is no photo.
     */
    async removeAvatar(req, res) {
        try {
            const result = await UserModel.updateProfilePicture(req.session.userId, null);
            if (!result) {
                return res.status(404).json({ status: 'error', message: 'Account not found.' });
            }

            req.session.profilePhoto = null;
            await deleteStored(result.previous);

            res.json({ status: 'ok', url: null });
        } catch (err) {
            console.error('[ProfileController.removeAvatar]', err);
            res.status(500).json({ status: 'error', message: 'Could not remove the photo.' });
        }
    },

    /**
     * Any signed-in user may view any avatar: students see faculty photos in the
     * directory, deans across their department, admins everywhere. The filename
     * is a UUID we generated, so it is not guessable from a user id.
     */
    serve(req, res) {
        const name = req.params.file;
        if (!STORED_NAME.test(name)) return res.status(404).end();

        // A replacement upload gets a fresh UUID and therefore a fresh URL, so a
        // cached copy can never become stale.
        res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
        res.sendFile(path.join(AVATAR_DIR, name), (err) => {
            if (err && !res.headersSent) res.status(404).end();
        });
    },
};

module.exports = ProfileController;
