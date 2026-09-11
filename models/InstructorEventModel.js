const pool = require('../configs/db');

/**
 * The instructor's own events and tasks.
 *
 * These sit alongside imported external events on the same calendar, and the
 * two are deliberately shaped alike — same half-hour slot indices, same
 * all_day and blocks flags — so the views merge them without translating.
 *
 * The difference that matters is ownership: external_events is a cache the
 * sync prunes and rewrites, while these are authored here and must survive.
 * That is why they are a separate table rather than rows with a special
 * connection id.
 */

const KINDS = ['event', 'task'];

/** 'HH:MM' -> half-hour index. Shared with workload_blocks and external_events. */
function timeToSlot(value) {
    const [h, m] = String(value).split(':').map(Number);
    return h * 2 + (m >= 30 ? 1 : 0);
}

function slotToTime(slot) {
    const mins = slot * 30;
    return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

const InstructorEventModel = {
    KINDS,
    timeToSlot,
    slotToTime,

    /** Everything in a date range, for the calendar grid. */
    async getForRange(instructorPublicId, startDate, endDate) {
        const [rows] = await pool.execute(
            `SELECT e.*
               FROM instructor_events e
               JOIN users u ON e.instructor_id = u.id
              WHERE u.public_id = ?
                AND e.event_date BETWEEN ? AND ?
              ORDER BY e.event_date ASC, e.all_day DESC, e.start_slot ASC`,
            [instructorPublicId, startDate, endDate]
        );
        return rows;
    },

    async getById(id, instructorPublicId) {
        const [rows] = await pool.execute(
            `SELECT e.* FROM instructor_events e
               JOIN users u ON e.instructor_id = u.id
              WHERE e.id = ? AND u.public_id = ?`,
            [id, instructorPublicId]
        );
        return rows[0] || null;
    },

    async create(instructorPublicId, data) {
        const [[user]] = await pool.execute(
            'SELECT id FROM users WHERE public_id = ?', [instructorPublicId]
        );
        if (!user) return null;

        const [result] = await pool.execute(
            `INSERT INTO instructor_events
                 (instructor_id, kind, title, notes, event_date, start_slot, end_slot, all_day, blocks)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                user.id, data.kind, data.title, data.notes || null, data.eventDate,
                data.allDay ? null : data.startSlot,
                data.allDay ? null : data.endSlot,
                data.allDay ? 1 : 0,
                data.blocks ? 1 : 0,
            ]
        );
        return result.insertId;
    },

    async update(id, instructorPublicId, data) {
        const [result] = await pool.execute(
            `UPDATE instructor_events e
               JOIN users u ON e.instructor_id = u.id
                SET e.kind = ?, e.title = ?, e.notes = ?, e.event_date = ?,
                    e.start_slot = ?, e.end_slot = ?, e.all_day = ?, e.blocks = ?
              WHERE e.id = ? AND u.public_id = ?`,
            [
                data.kind, data.title, data.notes || null, data.eventDate,
                data.allDay ? null : data.startSlot,
                data.allDay ? null : data.endSlot,
                data.allDay ? 1 : 0,
                data.blocks ? 1 : 0,
                id, instructorPublicId,
            ]
        );
        return result.affectedRows > 0;
    },

    async remove(id, instructorPublicId) {
        const [result] = await pool.execute(
            `DELETE e FROM instructor_events e
               JOIN users u ON e.instructor_id = u.id
              WHERE e.id = ? AND u.public_id = ?`,
            [id, instructorPublicId]
        );
        return result.affectedRows > 0;
    },

    /**
     * Everything for the outbound ICS feed, on the same window the appointment
     * feed uses so a subscriber sees one consistent stretch of calendar.
     */
    async getForFeed(instructorInternalId, { pastDays = 90, futureDays = 180 } = {}) {
        const [rows] = await pool.execute(
            `SELECT * FROM instructor_events
              WHERE instructor_id = ?
                AND event_date BETWEEN (CURDATE() - INTERVAL ? DAY)
                                   AND (CURDATE() + INTERVAL ? DAY)
              ORDER BY event_date ASC, start_slot ASC`,
            [instructorInternalId, pastDays, futureDays]
        );
        return rows;
    },

    /**
     * Blocking events as date + half-hour slots, matching the shape
     * CalendarModel.getBusyIntervals returns. The make-up scheduler unions the
     * two, so a generated class never lands on an event the instructor created.
     */
    async getBusyIntervals(instructorInternalId, startDate, endDate) {
        const [rows] = await pool.execute(
            `SELECT event_date, start_slot, end_slot, all_day, title, kind
               FROM instructor_events
              WHERE instructor_id = ? AND blocks = 1
                AND event_date BETWEEN ? AND ?`,
            [instructorInternalId, startDate, endDate]
        );

        return rows.map(r => ({
            date: String(r.event_date).slice(0, 10),
            startSlot: r.all_day ? 0 : r.start_slot,
            endSlot: r.all_day ? 48 : r.end_slot,
            label: r.title || `a personal ${r.kind}`,
            source: 'own-event',
        }));
    },

    /**
     * Consultations already booked inside the hours an event would block.
     *
     * Blocking an hour does not cancel what is already in it, so the modal
     * warns rather than silently double-booking the instructor.
     */
    async conflictingAppointments(instructorPublicId, { eventDate, startSlot, endSlot, allDay }) {
        const params = [instructorPublicId, eventDate];
        let window = '';

        if (!allDay) {
            window = ` AND SEC_TO_TIME(? * 1800) < ch.end_time
                       AND SEC_TO_TIME(? * 1800) > ch.start_time`;
            params.push(startSlot, endSlot);
        }

        const [rows] = await pool.execute(
            `SELECT a.id, a.topic, ch.start_time, ch.end_time,
                    CONCAT(s.first_name, ' ', s.last_name) AS student_name
               FROM appointments a
               JOIN consultation_hours ch ON a.consultation_hour_id = ch.id
               JOIN users i ON a.instructor_id = i.id
               JOIN users s ON a.student_id    = s.id
              WHERE i.public_id = ?
                AND a.status IN ('pending', 'confirmed')
                AND ch.consultation_date = ?${window}
              ORDER BY ch.start_time`,
            params
        );
        return rows;
    },
};

module.exports = InstructorEventModel;
