const pool = require('../configs/db');

/**
 * Per-instructor preferences from Instructor > Settings.
 *
 * A row is written lazily on the first save, so every read falls back to these
 * defaults. That also means students — who have no settings page — simply get
 * the defaults when the notification dispatcher asks about them.
 */
const DEFAULTS = {
    notifyNewRequests: true,
    notifyCancellations: true,
    notifyReminders: true,
    notifyBleAbsence: false,
    notifyAnnouncements: true,
    repeatWeekly: true,
    repeatWeeks: 4,
};

/** notifications.type → the preference that gates its email/push delivery. */
const TYPE_TO_PREFERENCE = {
    'new-request': 'notifyNewRequests',
    'cancellation': 'notifyCancellations',
    'reminder': 'notifyReminders',
    'alert': 'notifyBleAbsence',
    // A make-up submission is a new request too — it reaches the dean rather
    // than the instructor, and Dean > Settings labels it as such.
    'makeup': 'notifyNewRequests',
};

const COLUMNS = `notify_new_requests, notify_cancellations, notify_reminders,
                 notify_ble_absence, notify_announcements, repeat_weekly, repeat_weeks`;

function toSettings(row) {
    if (!row) return { ...DEFAULTS };
    return {
        notifyNewRequests: Boolean(row.notify_new_requests),
        notifyCancellations: Boolean(row.notify_cancellations),
        notifyReminders: Boolean(row.notify_reminders),
        notifyBleAbsence: Boolean(row.notify_ble_absence),
        notifyAnnouncements: Boolean(row.notify_announcements),
        repeatWeekly: Boolean(row.repeat_weekly),
        repeatWeeks: Number(row.repeat_weeks),
    };
}

const InstructorSettingsModel = {
    DEFAULTS,
    TYPE_TO_PREFERENCE,

    async getByPublicId(publicId) {
        const [rows] = await pool.execute(
            `SELECT ${COLUMNS}
               FROM instructor_settings s
               JOIN users u ON u.id = s.user_id
              WHERE u.public_id = ?`,
            [publicId]
        );
        return toSettings(rows[0]);
    },

    /** Used by the notification dispatcher, which only ever holds users.id. */
    async getByUserId(internalId) {
        const [rows] = await pool.execute(
            `SELECT ${COLUMNS} FROM instructor_settings WHERE user_id = ?`,
            [internalId]
        );
        return toSettings(rows[0]);
    },

    /**
     * Upsert the notification toggles. Only the five booleans are touched, so
     * saving one card can never clobber the schedule card's values.
     */
    async saveNotificationPrefs(publicId, prefs) {
        const [[user]] = await pool.execute(
            'SELECT id FROM users WHERE public_id = ?', [publicId]
        );
        if (!user) return false;

        const values = [
            prefs.notifyNewRequests, prefs.notifyCancellations, prefs.notifyReminders,
            prefs.notifyBleAbsence, prefs.notifyAnnouncements,
        ].map(v => (v ? 1 : 0));

        await pool.execute(
            `INSERT INTO instructor_settings
                 (user_id, notify_new_requests, notify_cancellations, notify_reminders,
                  notify_ble_absence, notify_announcements)
             VALUES (?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                 notify_new_requests  = VALUES(notify_new_requests),
                 notify_cancellations = VALUES(notify_cancellations),
                 notify_reminders     = VALUES(notify_reminders),
                 notify_ble_absence   = VALUES(notify_ble_absence),
                 notify_announcements = VALUES(notify_announcements)`,
            [user.id, ...values]
        );
        return true;
    },

    /** Upsert the consultation-schedule defaults applied to new slots. */
    async saveScheduleSettings(publicId, { repeatWeekly, repeatWeeks }) {
        const [[user]] = await pool.execute(
            'SELECT id FROM users WHERE public_id = ?', [publicId]
        );
        if (!user) return false;

        const parsed = parseInt(repeatWeeks, 10);
        const weeks = Number.isFinite(parsed) ? Math.max(2, Math.min(52, parsed)) : null;

        // No week count means "keep what is stored" — switching the toggle off
        // must not forget the span the instructor picked.
        await pool.execute(
            `INSERT INTO instructor_settings (user_id, repeat_weekly, repeat_weeks)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE
                 repeat_weekly = VALUES(repeat_weekly),
                 repeat_weeks  = COALESCE(?, repeat_weeks)`,
            [user.id, repeatWeekly ? 1 : 0, weeks === null ? DEFAULTS.repeatWeeks : weeks, weeks]
        );
        return true;
    },
};

module.exports = InstructorSettingsModel;
