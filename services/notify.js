/**
 * FaciTrack Notification Dispatcher
 *
 * One call fans a notification out to every channel:
 *   1. In-app  — the bell panel (always)
 *   2. Push    — device notification via the PWA service worker (when subscribed)
 *   3. Email   — opt-in per call, for status changes worth an inbox entry
 *
 * Channels fail independently: a dead SMTP server or an expired push
 * subscription must never break the in-app notification or the caller's
 * transaction, which has already committed by the time this runs.
 */

const NotificationModel = require('../models/NotificationModel');
const UserModel = require('../models/UserModel');
const InstructorSettingsModel = require('../models/InstructorSettingsModel');
const emailService = require('./email');
const push = require('./push');

// Where tapping a notification lands — shared with the email service so the
// two cannot drift apart. See utils/deepLink.js.
const { deepLink } = require('../utils/deepLink');

/**
 * @param {number} internalUserId  users.id (not public_id)
 * @param {string} type            notifications.type enum value
 * @param {string} message         in-app message text
 * @param {number|null} appointmentId
 * @param {object} [opts]
 * @param {object} [opts.email]    { heading, status, details } — omit to skip email
 * @param {string} [opts.pushTitle]
 * @param {boolean} [opts.push=true]
 */
async function notifyUser(internalUserId, type, message, appointmentId = null, opts = {}) {
    // ── 1. In-app (the source of truth for the bell) ──
    try {
        await NotificationModel.create(internalUserId, type, message, appointmentId);
    } catch (err) {
        console.error('[Notify] In-app notification failed:', err.message);
    }

    // Both email and push need the recipient's details
    let user = null;
    if (opts.email || opts.push !== false) {
        try {
            user = await UserModel.getUserById(internalUserId);
        } catch (err) {
            console.error('[Notify] Could not load recipient:', err.message);
        }
    }
    if (!user) return;

    // Settings > Notification Preferences gates the outbound channels only.
    // Students have no settings page and simply fall back to the defaults.
    let allowed = true;
    const preference = InstructorSettingsModel.TYPE_TO_PREFERENCE[type];
    if (preference) {
        try {
            const prefs = await InstructorSettingsModel.getByUserId(internalUserId);
            allowed = prefs[preference];
        } catch (err) {
            // Never silence a notification because the lookup broke
            console.error('[Notify] Could not load preferences:', err.message);
        }
    }
    if (!allowed) return;

    // ── 2. Push (device notification, works with the app closed) ──
    // The administrator can switch the whole channel off in System Settings;
    // the in-app bell above is unaffected either way.
    let pushEnabled = true;
    try {
        pushEnabled = await require('./app-settings').get('push_enabled');
    } catch (err) {
        console.error('[Notify] Could not read the push setting:', err.message);
    }

    if (opts.push !== false && pushEnabled) {
        try {
            await push.sendToUser(internalUserId, {
                title: opts.pushTitle || opts.email?.heading || 'FaciTrack',
                body: message,
                url: deepLink(appointmentId, user.role, type) || '/',
                // Same tag replaces an older notification for the same booking
                // instead of stacking duplicates on the device.
                tag: appointmentId ? `apt-${appointmentId}` : 'facitrack',
            });
        } catch (err) {
            console.error('[Notify] Push failed:', err.message);
        }
    }

    // ── 3. Email (opt-in) ──
    if (opts.email && user.email) {
        try {
            await emailService.sendStatusUpdate({
                to: user.email,
                name: user.first_name,
                heading: opts.email.heading,
                status: opts.email.status || type,
                message: opts.email.message || message,
                details: opts.email.details || [],
                appointmentId,
                role: user.role,
                type,
            });
        } catch (err) {
            console.error('[Notify] Email failed:', err.message);
        }
    }
}

module.exports = { notifyUser, deepLink };
