const cron = require('node-cron');
const AppointmentModel = require('../models/AppointmentModel');
const NotificationModel = require('../models/NotificationModel');
const { formatFullDate, to12Hour } = require('../utils/timeFormat');

// How long to wait before chasing the same unclosed consultation again
const COMPLETION_NUDGE_EVERY_HOURS = Number(process.env.COMPLETION_NUDGE_EVERY_HOURS) || 24;

// Unanswered booking requests are chased more often — a student is waiting,
// and an unanswered request goes stale once the consultation date passes.
const PENDING_NUDGE_EVERY_HOURS = Number(process.env.PENDING_NUDGE_EVERY_HOURS) || 6;

/** Remind both parties shortly before a consultation starts. */
async function sendUpcomingReminders() {
    const upcoming = await AppointmentModel.getAppointmentsNeedingReminder();

    for (const apt of upcoming) {
        const dateLabel = formatFullDate(apt.consultation_date);
        const timeLabel = to12Hour(apt.start_time);

        await NotificationModel.create(
            apt.student_id,
            'reminder',
            `Reminder: your consultation with ${apt.instructor_first_name} ${apt.instructor_last_name} is at ${timeLabel} today, ${dateLabel}.`,
            apt.id
        );
        await NotificationModel.create(
            apt.instructor_id,
            'reminder',
            `Reminder: you have a consultation at ${timeLabel} today, ${dateLabel}.`,
            apt.id
        );

        await AppointmentModel.markReminderSent(apt.id);
    }
}

/**
 * Chase instructors whose consultation has finished but is still sitting at
 * 'confirmed'. Repeats every COMPLETION_NUDGE_EVERY_HOURS until they act,
 * so a forgotten consultation does not stay open indefinitely.
 */
async function sendCompletionNudges() {
    const pending = await AppointmentModel.getAppointmentsAwaitingCompletion(COMPLETION_NUDGE_EVERY_HOURS);

    for (const apt of pending) {
        const dateLabel = formatFullDate(apt.consultation_date);
        const timeLabel = to12Hour(apt.start_time);

        await NotificationModel.create(
            apt.instructor_id,
            'alert',
            `Your consultation with ${apt.student_first_name} ${apt.student_last_name} on ${dateLabel} at ${timeLabel} has ended. Mark it complete to close it out.`,
            apt.id
        );

        await AppointmentModel.markCompletionNudged(apt.id);
    }
}

/**
 * Chase instructors sitting on unanswered booking requests. Repeats every
 * PENDING_NUDGE_EVERY_HOURS until they approve or decline, so a student is
 * never left waiting indefinitely on a request that was simply missed.
 */
async function sendPendingRequestNudges() {
    const waiting = await AppointmentModel.getPendingAppointmentsAwaitingAction(PENDING_NUDGE_EVERY_HOURS);

    for (const apt of waiting) {
        const dateLabel = formatFullDate(apt.consultation_date);
        const timeLabel = to12Hour(apt.start_time);

        await NotificationModel.create(
            apt.instructor_id,
            'new-request',
            `${apt.student_first_name} ${apt.student_last_name} is still waiting for a response to their consultation request on ${dateLabel} at ${timeLabel}.`,
            apt.id
        );

        await AppointmentModel.markPendingNudged(apt.id);
    }
}

/**
 * Chase instructors whose upcoming online consultations still have no meeting
 * link. The student sees "link coming soon" until this is resolved.
 */
async function sendMissingLinkNudges() {
    const missing = await AppointmentModel.getOnlineAppointmentsMissingLink(COMPLETION_NUDGE_EVERY_HOURS);

    for (const apt of missing) {
        const dateLabel = formatFullDate(apt.consultation_date);
        const timeLabel = to12Hour(apt.start_time);

        await NotificationModel.create(
            apt.instructor_id,
            'alert',
            `Your online consultation with ${apt.student_first_name} ${apt.student_last_name} on ${dateLabel} at ${timeLabel} has no meeting link. Add one in Settings so the student can join.`,
            apt.id
        );

        await AppointmentModel.markCompletionNudged(apt.id);
    }
}

function startReminderJob() {
    // Upcoming-consultation reminders — needs minute precision
    cron.schedule('* * * * *', async () => {
        try {
            await sendUpcomingReminders();
        } catch (err) {
            console.error('[ReminderJob] Upcoming reminders failed:', err);
        }
    });

    // Follow-up nudges — hourly; each one's own throttle decides who is due.
    // Kept in separate try blocks so one failing query cannot stop the others.
    cron.schedule('0 * * * *', async () => {
        try {
            await sendPendingRequestNudges();
        } catch (err) {
            console.error('[ReminderJob] Pending-request nudges failed:', err);
        }
        try {
            await sendCompletionNudges();
        } catch (err) {
            console.error('[ReminderJob] Completion nudges failed:', err);
        }
        try {
            await sendMissingLinkNudges();
        } catch (err) {
            console.error('[ReminderJob] Missing-link nudges failed:', err);
        }
    });
}

module.exports = startReminderJob;
module.exports.sendUpcomingReminders = sendUpcomingReminders;
module.exports.sendCompletionNudges = sendCompletionNudges;
module.exports.sendMissingLinkNudges = sendMissingLinkNudges;
module.exports.sendPendingRequestNudges = sendPendingRequestNudges;
