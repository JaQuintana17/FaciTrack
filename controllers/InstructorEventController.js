const InstructorEventModel = require('../models/InstructorEventModel');
const AuditLogModel = require('../models/AuditLogModel');
const UserModel = require('../models/UserModel');

/**
 * The instructor's own events and tasks.
 *
 * Every write goes through the model's public_id join, so an id belonging to
 * somebody else simply matches no rows rather than needing a separate
 * ownership check that could be forgotten.
 */

const MAX_SLOT = 48;   // 24h in half-hour steps

function toDateKey(value) {
    return String(value || '').slice(0, 10);
}

/**
 * Validate and normalise the payload.
 * Returns { data } or { error }.
 */
function parseBody(body) {
    const title = String(body.title || '').trim();
    if (!title) return { error: 'Give it a title.' };
    if (title.length > 200) return { error: 'Titles are limited to 200 characters.' };

    const kind = InstructorEventModel.KINDS.includes(body.kind) ? body.kind : 'event';

    const eventDate = toDateKey(body.eventDate);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) return { error: 'Pick a valid date.' };

    const allDay = Boolean(body.allDay);
    let startSlot = null;
    let endSlot = null;

    if (!allDay) {
        if (!body.startTime || !body.endTime) {
            return { error: 'Set a start and end time, or mark it all day.' };
        }
        startSlot = InstructorEventModel.timeToSlot(body.startTime);
        endSlot = InstructorEventModel.timeToSlot(body.endTime);

        if (!Number.isInteger(startSlot) || !Number.isInteger(endSlot)) {
            return { error: 'That time is not valid.' };
        }
        if (startSlot < 0 || endSlot > MAX_SLOT) return { error: 'That time is out of range.' };
        // Equal would be a zero-length event, which blocks nothing and shows as
        // a sliver on the grid
        if (endSlot <= startSlot) return { error: 'The end time must be after the start time.' };
    }

    const notes = String(body.notes || '').trim();
    if (notes.length > 500) return { error: 'Notes are limited to 500 characters.' };

    return {
        data: {
            kind, title, notes, eventDate, allDay, startSlot, endSlot,
            // A task defaults to not blocking: it is usually a reminder to
            // oneself, not a reason students cannot book.
            blocks: body.blocks === undefined ? kind === 'event' : Boolean(body.blocks),
            // Only meaningful for a task; an event is never "done"
            done: kind === 'task' ? Boolean(body.done) : false,
        },
    };
}

/** Shape a row for the calendar grid. */
function toClient(row) {
    return {
        id: row.id,
        kind: row.kind,
        title: row.title,
        notes: row.notes || '',
        date: toDateKey(row.event_date),
        startSlot: row.start_slot,
        endSlot: row.end_slot,
        startTime: row.all_day ? null : InstructorEventModel.slotToTime(row.start_slot),
        endTime: row.all_day ? null : InstructorEventModel.slotToTime(row.end_slot),
        allDay: Boolean(row.all_day),
        blocks: Boolean(row.blocks),
        done: Boolean(row.done),
    };
}

async function logIt(req, action) {
    try {
        const me = await UserModel.getUserByPublicId(req.session.userId);
        await AuditLogModel.log(me.internal_id, me.role, action, 'calendar');
    } catch (err) {
        console.error('[AuditLog] Failed to log event change:', err);
    }
}

const InstructorEventController = {

    /** Events in a window, for the appointments calendar. */
    async list(req, res) {
        try {
            const start = toDateKey(req.query.start);
            const end = toDateKey(req.query.end);
            if (!start || !end) {
                return res.status(400).json({ success: false, error: 'A start and end date are required.' });
            }

            const rows = await InstructorEventModel.getForRange(req.session.userId, start, end);
            res.json({ success: true, events: rows.map(toClient) });
        } catch (err) {
            console.error('[InstructorEventController.list]', err);
            res.status(500).json({ success: false, error: 'Failed to load your events.' });
        }
    },

    /**
     * Consultations that would sit inside a blocking event.
     *
     * Called before saving so the modal can warn. Blocking an hour never
     * cancels what is already booked in it — that stays the instructor's
     * decision, made from the appointment itself.
     */
    async conflicts(req, res) {
        try {
            const parsed = parseBody(req.body);
            if (parsed.error) return res.json({ success: true, conflicts: [] });
            if (!parsed.data.blocks) return res.json({ success: true, conflicts: [] });

            const rows = await InstructorEventModel.conflictingAppointments(
                req.session.userId, parsed.data);

            res.json({
                success: true,
                conflicts: rows.map(r => ({
                    id: r.id,
                    student: r.student_name,
                    topic: r.topic,
                    time: `${String(r.start_time).slice(0, 5)} – ${String(r.end_time).slice(0, 5)}`,
                })),
            });
        } catch (err) {
            console.error('[InstructorEventController.conflicts]', err);
            res.json({ success: true, conflicts: [] });   // never block the save on this
        }
    },

    async create(req, res) {
        try {
            const parsed = parseBody(req.body);
            if (parsed.error) return res.status(422).json({ success: false, error: parsed.error });

            const id = await InstructorEventModel.create(req.session.userId, parsed.data);
            if (!id) return res.status(404).json({ success: false, error: 'Account not found.' });

            await logIt(req, `Added calendar ${parsed.data.kind}: ${parsed.data.title}`);
            res.json({ success: true, id });
        } catch (err) {
            console.error('[InstructorEventController.create]', err);
            res.status(500).json({ success: false, error: 'Failed to save.' });
        }
    },

    async update(req, res) {
        try {
            const parsed = parseBody(req.body);
            if (parsed.error) return res.status(422).json({ success: false, error: parsed.error });

            const ok = await InstructorEventModel.update(req.params.id, req.session.userId, parsed.data);
            if (!ok) return res.status(404).json({ success: false, error: 'Not found.' });

            await logIt(req, `Edited calendar ${parsed.data.kind}: ${parsed.data.title}`);
            res.json({ success: true });
        } catch (err) {
            console.error('[InstructorEventController.update]', err);
            res.status(500).json({ success: false, error: 'Failed to save.' });
        }
    },

    async toggleDone(req, res) {
        try {
            const ok = await InstructorEventModel.setDone(
                req.params.id, req.session.userId, Boolean(req.body.done));
            if (!ok) return res.status(404).json({ success: false, error: 'Task not found.' });
            res.json({ success: true });
        } catch (err) {
            console.error('[InstructorEventController.toggleDone]', err);
            res.status(500).json({ success: false, error: 'Failed to update the task.' });
        }
    },

    async remove(req, res) {
        try {
            const ok = await InstructorEventModel.remove(req.params.id, req.session.userId);
            if (!ok) return res.status(404).json({ success: false, error: 'Not found.' });

            await logIt(req, 'Deleted a calendar entry');
            res.json({ success: true });
        } catch (err) {
            console.error('[InstructorEventController.remove]', err);
            res.status(500).json({ success: false, error: 'Failed to delete.' });
        }
    },
};

module.exports = InstructorEventController;
module.exports.toClient = toClient;
