const crypto = require('crypto');
const Google = require('../services/google-calendar');
const GoogleAccountModel = require('../models/GoogleAccountModel');
const CalendarModel = require('../models/CalendarModel');
const UserModel = require('../models/UserModel');
const AuditLogModel = require('../models/AuditLogModel');

const SETTINGS_URL = '/instructor/settings';

/**
 * Connecting an instructor's Google Calendar.
 *
 * One connection, two jobs: online consultations get a real scheduled Meet,
 * and the instructor's own events are read back so students cannot book over
 * them. The same calendar.events scope covers both, which is why this is a
 * single button rather than two separate setups.
 *
 * Separate from the sign-in flow in configs/passport.js on purpose. That one
 * proves who you are and asks for nothing else; this one asks for standing
 * write access to a calendar. Bundling the calendar scope into login would put
 * that consent screen in front of every student signing in, for a permission
 * only instructors will ever use.
 */
const GoogleCalendarController = {

    /** Step 1 — send the instructor to Google's consent screen. */
    async connect(req, res) {
        if (!Google.isConfigured()) {
            return res.redirect(`${SETTINGS_URL}?googleError=not_configured`);
        }

        // CSRF for the callback: a bare callback URL is otherwise a link anyone
        // could send an instructor to attach an attacker's Google account.
        const state = crypto.randomBytes(16).toString('base64url');
        req.session.googleOAuthState = state;

        res.redirect(Google.consentUrl(req, state));
    },

    /** Step 2 — Google redirects back here with a one-time code. */
    async callback(req, res) {
        const { code, state, error } = req.query;
        const expected = req.session.googleOAuthState;
        delete req.session.googleOAuthState;

        // The instructor pressed Cancel on the consent screen.
        if (error) return res.redirect(`${SETTINGS_URL}?googleError=denied`);

        if (!code || !state || state !== expected) {
            return res.redirect(`${SETTINGS_URL}?googleError=state_mismatch`);
        }

        try {
            const tokens = await Google.exchangeCode(code, Google.redirectUri(req));
            const me = await UserModel.getUserByPublicId(req.session.userId);
            if (!me) return res.redirect(`${SETTINGS_URL}?googleError=unknown`);

            await GoogleAccountModel.save(me.internal_id, {
                googleEmail:  tokens.email,
                refreshToken: tokens.refreshToken,
                accessToken:  tokens.accessToken,
                expiresAt:    tokens.expiresAt,
                scope:        tokens.scope,
            });

            // Give the events somewhere to land, then pull once immediately —
            // waiting up to 20 minutes for the cron would make a fresh
            // connection look broken.
            let imported = 0;
            try {
                const connectionId = await CalendarModel.ensureGoogleConnection(me.internal_id);
                const synced = await CalendarModel.syncConnection(connectionId);
                imported = synced.imported || 0;
            } catch (err) {
                // The connection itself succeeded; the cron will retry the pull.
                console.error('[GoogleCalendar] First sync after connecting failed:', err.message);
            }

            try {
                await AuditLogModel.log(me.internal_id, me.role, 'Connected Google Calendar', 'settings');
            } catch (err) {
                console.error('[AuditLog] Failed to log Google connect:', err);
            }

            res.redirect(`${SETTINGS_URL}?googleConnected=1&imported=${imported}`);
        } catch (err) {
            console.error('[GoogleCalendar] Connect failed:', err.message);
            res.redirect(`${SETTINGS_URL}?googleError=exchange_failed`);
        }
    },

    /**
     * Disconnect.
     *
     * Meetings already scheduled are deliberately left alone — they are on the
     * instructor's calendar and students already hold the links, so tearing
     * them down would cancel consultations that are still going ahead. Only
     * future bookings fall back to the static link.
     *
     * Imported events are the opposite case and do go: they are a cache of
     * someone else's calendar, and keeping them would block bookings using
     * data FaciTrack can no longer refresh.
     */
    async disconnect(req, res) {
        try {
            const me = await UserModel.getUserByPublicId(req.session.userId);
            if (!me) return res.status(404).json({ success: false, error: 'User not found.' });

            const account = await GoogleAccountModel.getByUserId(me.internal_id);
            if (account?.refresh_token) await Google.revokeToken(account.refresh_token);

            await GoogleAccountModel.remove(me.internal_id);
            await CalendarModel.removeGoogleConnection(me.internal_id);

            try {
                await AuditLogModel.log(me.internal_id, me.role, 'Disconnected Google Calendar', 'settings');
            } catch (err) {
                console.error('[AuditLog] Failed to log Google disconnect:', err);
            }

            res.json({ success: true });
        } catch (err) {
            console.error('[GoogleCalendar] Disconnect failed:', err);
            res.status(500).json({ success: false, error: 'Could not disconnect Google Calendar.' });
        }
    },
};

module.exports = GoogleCalendarController;
