const UserModel = require('../models/UserModel');
const AppointmentModel = require('../models/AppointmentModel');
const InstructorEventModel = require('../models/InstructorEventModel');
const AuditLogModel = require('../models/AuditLogModel');
const { buildCalendar } = require('../services/calendar-ics');

/**
 * The outbound calendar feed.
 *
 * `serve` is deliberately session-less: Google's and Apple's fetchers arrive
 * with no cookies, so the token in the path is the whole credential. The rest
 * of the endpoints are the logged-in half — minting the URL and revoking it.
 */

/** Instructors and students each get their own view of a booking. */
const FEED_ROLES = { Instructor: 'instructor', Student: 'student' };

function baseUrl(req) {
    return (process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
}

function feedUrls(req, token) {
    const https = `${baseUrl(req)}/calendar/feed/${token}.ics`;
    return {
        url: https,
        // webcal:// is what makes "Subscribe" one click in both clients
        webcal: https.replace(/^https?:/, 'webcal:'),
    };
}

const CalendarFeedController = {

    /**
     * Serve one person's schedule as ICS.
     *
     * Every failure answers 404 rather than 401/403 — a distinct "wrong token"
     * response would confirm which tokens exist and turn this into an oracle.
     */
    async serve(req, res) {
        try {
            const token = String(req.params.token || '').replace(/\.ics$/i, '');
            const user = await UserModel.getUserByFeedToken(token);

            const audience = user && FEED_ROLES[user.role];
            if (!user || !audience || user.status !== 'Active') {
                return res.status(404).type('text/plain').send('Calendar not found.');
            }

            const rows = await AppointmentModel.getAppointmentsForFeed(user.internal_id, audience);

            // Personal events belong to the instructor and only to their feed —
            // a student subscribing must never see them.
            const ownEvents = audience === 'instructor'
                ? await InstructorEventModel.getForFeed(user.internal_id)
                : [];

            const ics = buildCalendar(rows, {
                audience,
                ownerName: `${user.first_name} ${user.last_name}`,
                host: req.get('host') || 'facitrack.local',
                ownEvents,
            });

            res.set({
                'Content-Type': 'text/calendar; charset=utf-8',
                'Content-Disposition': 'inline; filename="facitrack.ics"',
                // Subscribers poll on their own schedule; nothing should sit in
                // an intermediary cache serving a stale week.
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'X-Content-Type-Options': 'nosniff',
            });
            res.send(ics);
        } catch (err) {
            console.error('[CalendarFeedController.serve]', err);
            res.status(500).type('text/plain').send('Failed to build the calendar.');
        }
    },

    /** The subscription URL for whoever is logged in, minting one if needed. */
    async getMine(req, res) {
        try {
            const token = await UserModel.getOrCreateFeedToken(req.session.userId);
            if (!token) return res.status(404).json({ success: false, error: 'Account not found.' });
            res.json({ success: true, ...feedUrls(req, token) });
        } catch (err) {
            console.error('[CalendarFeedController.getMine]', err);
            res.status(500).json({ success: false, error: 'Failed to build the feed link.' });
        }
    },

    /** Revoke the old URL and issue a new one. Existing subscriptions break. */
    async rotate(req, res) {
        try {
            const token = await UserModel.rotateFeedToken(req.session.userId);
            if (!token) return res.status(404).json({ success: false, error: 'Account not found.' });

            try {
                const me = await UserModel.getUserByPublicId(req.session.userId);
                await AuditLogModel.log(me.internal_id, me.role,
                    'Regenerated calendar feed link', 'settings');
            } catch (err) {
                console.error('[AuditLog] Failed to log feed rotation:', err);
            }

            res.json({ success: true, ...feedUrls(req, token) });
        } catch (err) {
            console.error('[CalendarFeedController.rotate]', err);
            res.status(500).json({ success: false, error: 'Failed to regenerate the link.' });
        }
    },
};

module.exports = CalendarFeedController;
