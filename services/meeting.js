/**
 * Meeting links for online consultations.
 *
 * There are two ways an online consultation gets a link, in this order:
 *
 *   1. A scheduled Google Meet, created on the instructor's own calendar for
 *      this one appointment, with the student invited.
 *   2. The instructor's static default_meeting_link — their personal room,
 *      reused for everyone. This is what the system did before, and it stays
 *      as the fallback.
 *
 * Every failure path here falls through to (2) rather than raising. A student
 * must never lose a booking because Google was slow, and an instructor who
 * has not connected their calendar must keep working exactly as before.
 *
 * This talks to the appointments table directly instead of going through
 * AppointmentModel, which is what calls it — importing the model back would
 * close a require cycle.
 */
const pool = require('../configs/db');
const Google = require('./google-calendar');
const GoogleAccountModel = require('../models/GoogleAccountModel');
const { to12Hour, formatFullDate } = require('../utils/timeFormat');

/**
 * Google's failures, said in a sentence an instructor can act on.
 *
 * The raw messages are long and addressed to whoever administers the Cloud
 * project, not to the person whose consultation has no link. Recording a short
 * version against the connection is what lets Settings stop claiming to be
 * connected when nothing it does actually works.
 */
function describeFailure(message) {
    const text = String(message || '');

    if (/has not been used in project|is disabled|SERVICE_DISABLED/i.test(text)) {
        return 'Google Calendar API is not enabled for this system. Ask the administrator to enable it in Google Cloud.';
    }
    if (/insufficient|insufficientPermissions|forbidden|403/i.test(text)) {
        return 'Google refused the request. Disconnect and reconnect to grant calendar access again.';
    }
    if (/invalid_grant|unauthorized|401/i.test(text)) {
        return 'Access was revoked on Google. Reconnect to keep creating Meet links.';
    }
    if (/quota|rateLimit|userRateLimitExceeded/i.test(text)) {
        return 'Google is rate-limiting this system. Meet links will resume shortly.';
    }
    return 'Google could not create the meeting: ' + text.slice(0, 150);
}

/**
 * Creates the Meet for a freshly booked online consultation and stores it.
 *
 * Called after the booking transaction has committed — a network round-trip
 * has no place inside a transaction holding a row lock on the slot, and an
 * appointment that exists with the fallback link is a far better outcome than
 * one that rolled back because Calendar timed out.
 *
 * Returns the link that ended up on the appointment, whichever source it came
 * from, so the caller can put the right URL in its notifications.
 */
async function provisionMeetingLink({
    appointmentId, instructorId, studentName, studentEmail,
    topic, date, startTime, endTime, fallbackLink = null,
}) {
    const accessToken = await GoogleAccountModel.accessTokenFor(instructorId);
    if (!accessToken) return { meetingLink: fallbackLink, eventId: null, source: 'default' };

    try {
        const when = `${formatFullDate(date)}, ${to12Hour(startTime)} – ${to12Hour(endTime)}`;
        const { eventId, meetingLink } = await Google.createMeetEvent(accessToken, {
            summary: `Consultation — ${studentName}`,
            description:
                `FaciTrack consultation.\n\n` +
                `Student: ${studentName}\n` +
                `Topic: ${topic}\n` +
                `When: ${when}\n\n` +
                `This meeting was scheduled automatically when the consultation was booked.`,
            date,
            startTime,
            endTime,
            attendeeEmails: [studentEmail],
        });

        await pool.execute(
            'UPDATE appointments SET meeting_link = ?, google_event_id = ? WHERE id = ?',
            [meetingLink, eventId, appointmentId]
        );

        // Something worked, so any recorded failure is out of date.
        try {
            await GoogleAccountModel.clearError(instructorId);
        } catch (err) {
            console.error('[Meeting] Could not clear the stored connection error:', err.message);
        }

        return { meetingLink, eventId, source: 'google' };
    } catch (err) {
        // The booking still stands — it already carries whatever fallback link
        // the instructor has. But the connection is not working, and until this
        // was recorded the instructor's Settings page went on saying
        // "Connected" while every online booking quietly got no link. The
        // student was told their instructor had not added one, which was not
        // true and named the wrong person.
        console.error(`[Meeting] Could not create a Meet for appointment ${appointmentId}:`, err.message);

        try {
            await GoogleAccountModel.markError(instructorId, describeFailure(err.message));
        } catch (markErr) {
            console.error('[Meeting] Could not record the connection failure:', markErr.message);
        }

        return { meetingLink: fallbackLink, eventId: null, source: 'default' };
    }
}

/**
 * Cancels the calendar event behind an appointment, if it had one.
 *
 * Called when a consultation is declined, cancelled or rescheduled. Skipping
 * this would leave a live meeting and a calendar entry for a consultation
 * that is no longer happening — the instructor's calendar would slowly fill
 * with meetings nobody is attending.
 */
async function releaseMeetingLink(appointmentId) {
    let row;
    try {
        [[row]] = await pool.execute(
            'SELECT instructor_id, google_event_id FROM appointments WHERE id = ?',
            [appointmentId]
        );
    } catch (err) {
        console.error('[Meeting] Could not look up the calendar event:', err.message);
        return false;
    }

    if (!row || !row.google_event_id) return false;

    const accessToken = await GoogleAccountModel.accessTokenFor(row.instructor_id);
    if (!accessToken) return false;

    try {
        await Google.deleteEvent(accessToken, row.google_event_id);
        // Cleared even on the delete path so a later retry cannot try again
        // against an id that is already gone.
        await pool.execute('UPDATE appointments SET google_event_id = NULL WHERE id = ?', [appointmentId]);
        return true;
    } catch (err) {
        console.error(`[Meeting] Could not cancel the event for appointment ${appointmentId}:`, err.message);
        return false;
    }
}

module.exports = { provisionMeetingLink, releaseMeetingLink };
