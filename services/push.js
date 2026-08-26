/**
 * FaciTrack Web Push
 *
 * Sends notifications to a user's device even when FaciTrack is closed.
 * Requires VAPID keys in .env (generate with: node scripts/generate-vapid-keys.js).
 * With no keys configured every send is a silent no-op, so the app runs fine
 * without push until you turn it on.
 */

const webpush = require('web-push');
const PushSubscriptionModel = require('../models/PushSubscriptionModel');

const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const CONTACT = process.env.VAPID_SUBJECT || 'mailto:noreply@cspc.edu.ph';

const isConfigured = Boolean(PUBLIC_KEY && PRIVATE_KEY);

if (isConfigured) {
    webpush.setVapidDetails(CONTACT, PUBLIC_KEY, PRIVATE_KEY);
} else {
    console.log('[Push] VAPID keys not set — device notifications are disabled.');
}

/**
 * Push to every device a user has registered.
 * Subscriptions the push service reports as gone (404/410) are deleted, which
 * is how a browser that cleared its data or uninstalled the PWA gets cleaned up.
 */
async function sendToUser(internalUserId, { title, body, url, tag }) {
    if (!isConfigured || !internalUserId) return { sent: 0, failed: 0 };

    let subs = [];
    try {
        subs = await PushSubscriptionModel.getForUser(internalUserId);
    } catch (err) {
        console.error('[Push] Failed to load subscriptions:', err.message);
        return { sent: 0, failed: 0 };
    }
    if (!subs.length) return { sent: 0, failed: 0 };

    const payload = JSON.stringify({
        title: title || 'FaciTrack',
        body: body || '',
        url: url || '/',
        tag: tag || 'facitrack',
    });

    let sent = 0, failed = 0;

    await Promise.all(subs.map(async (sub) => {
        try {
            await webpush.sendNotification(
                { endpoint: sub.endpoint, keys: sub.keys },
                payload
            );
            sent++;
        } catch (err) {
            failed++;
            // 410 Gone / 404 Not Found = this subscription is permanently dead
            if (err.statusCode === 410 || err.statusCode === 404) {
                try {
                    await PushSubscriptionModel.removeById(sub.id);
                } catch (_) { /* best effort */ }
            } else {
                console.error('[Push] Send failed:', err.statusCode, err.message);
            }
        }
    }));

    return { sent, failed };
}

module.exports = {
    sendToUser,
    isConfigured,
    publicKey: PUBLIC_KEY || null,
};
