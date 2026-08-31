const pool = require('../configs/db');

/**
 * The administrator's view of what is happening in the department's
 * consultation room: the booked time, not the empty time.
 *
 * A published slot with nobody in it is the instructor's business, so only
 * slots that someone is actually sitting in — or is in the middle of booking —
 * come back. Online consultations are left out as well: they never occupy the
 * room, which is what this page is about.
 *
 * The three states live in three tables — consultation_hours, appointments and
 * slot_reservations — so they are stitched together here rather than in the page.
 */

const SLOT_QUERY = `
    SELECT ch.id                AS slot_id,
           ch.consultation_date AS date,
           ch.start_time,
           ch.end_time,
           ins.public_id        AS instructor_id,
           CONCAT(ins.first_name, ' ', ins.last_name) AS instructor_name,
           ins.position,
           dept.short_name      AS department,
           ap.id                AS appointment_id,
           ap.status            AS appointment_status,
           ap.mode,
           ap.topic,
           ap.course_subject,
           ap.section_group_name,
           ap.student_number,
           CONCAT(stu.first_name, ' ', stu.last_name) AS student_name,
           room.room_number,
           res.expires_at       AS hold_expires_at
      FROM consultation_hours ch
      JOIN users ins            ON ins.id  = ch.instructor_id
      LEFT JOIN departments dept ON dept.id = ins.department_id
      -- Cancelled, declined and superseded bookings free the slot again, and an
      -- Online consultation never uses the room, so neither belongs here.
      LEFT JOIN appointments ap ON ap.consultation_hour_id = ch.id
                               AND ap.status IN ('pending', 'confirmed', 'completed')
                               AND ap.mode = 'Face-to-Face'
      LEFT JOIN users stu       ON stu.id  = ap.student_id
      LEFT JOIN rooms room      ON room.id = ap.room_id
      -- An expired hold is no hold at all
      LEFT JOIN slot_reservations res ON res.slot_id = ch.id AND res.expires_at > NOW()
     WHERE ch.consultation_date BETWEEN ? AND ?
       AND (ap.id IS NOT NULL OR res.id IS NOT NULL)
`;

// Which appointment wins when a slot has had more than one live booking against
// it — the most committed state is the one worth showing.
const STATUS_RANK = { confirmed: 3, completed: 2, pending: 1 };

const ConsultationRoomModel = {

    /**
     * @param {string} startDate  YYYY-MM-DD, inclusive
     * @param {string} endDate    YYYY-MM-DD, inclusive
     * @param {{instructorId?: string, departmentId?: number}} filters
     */
    async getSlots(startDate, endDate, { instructorId = null, departmentId = null } = {}) {
        let query = SLOT_QUERY;
        const params = [startDate, endDate];

        // An administrator sees their own department's room, nobody else's
        if (departmentId) {
            query += ' AND ins.department_id = ?';
            params.push(departmentId);
        }
        if (instructorId) {
            query += ' AND ins.public_id = ?';
            params.push(instructorId);
        }
        query += ' ORDER BY ch.consultation_date ASC, ch.start_time ASC, instructor_name ASC';

        const [rows] = await pool.execute(query, params);

        // Collapse to one row per slot, keeping the strongest booking
        const bySlot = new Map();
        for (const row of rows) {
            const held = bySlot.get(row.slot_id);
            if (!held || rank(row) > rank(held)) bySlot.set(row.slot_id, row);
        }

        return [...bySlot.values()].map(shape);
    },

    /** Active instructors in the department, for the page's filter. */
    async getInstructors(departmentId = null) {
        let query = `SELECT public_id, first_name, last_name
                       FROM users
                      WHERE role = 'Instructor' AND status = 'Active'`;
        const params = [];

        if (departmentId) {
            query += ' AND department_id = ?';
            params.push(departmentId);
        }
        query += ' ORDER BY last_name ASC, first_name ASC';

        const [rows] = await pool.execute(query, params);
        return rows;
    },
};

function rank(row) {
    return STATUS_RANK[row.appointment_status] || 0;
}

/** One slot, with its state already worked out so the page does not re-derive it. */
function shape(row) {
    return {
        slotId: row.slot_id,
        date: row.date,
        startTime: row.start_time,
        endTime: row.end_time,
        state: stateOf(row),
        instructorId: row.instructor_id,
        instructorName: row.instructor_name,
        position: row.position,
        department: row.department,
        appointmentId: row.appointment_id,
        appointmentStatus: row.appointment_status,
        topic: row.topic,
        courseSubject: row.course_subject,
        section: row.section_group_name,
        studentName: row.student_name,
        studentNumber: row.student_number,
        roomNumber: row.room_number,
        holdExpiresAt: row.hold_expires_at,
    };
}

function stateOf(row) {
    if (row.appointment_status === 'confirmed') return 'Confirmed';
    if (row.appointment_status === 'completed') return 'Completed';
    if (row.appointment_status === 'pending') return 'Pending';
    return 'Booking';   // only reachable via an unexpired hold
}

module.exports = ConsultationRoomModel;
