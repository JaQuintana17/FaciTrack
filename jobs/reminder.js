
const cron = require('node-cron');
const AppointmentModel = require('../models/AppointmentModel');
const NotificationModel = require('../models/NotificationModel');
const { formatFullDate, to12Hour } = require('../utils/timeFormat');

function startReminderJob() {
    cron.schedule('* * * * *', async () => { // every minute
        try {
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
        } catch (err) {
            console.error('[ReminderJob] Failed:', err);
        }
    });
}

module.exports = startReminderJob;