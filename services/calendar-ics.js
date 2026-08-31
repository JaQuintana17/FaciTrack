/**
 * Publishes FaciTrack's own schedule as an iCalendar feed.
 *
 * The inbound half of calendar sync lives in services/calendar-feed.js; this is
 * the outbound half. One format serves both Google Calendar and Apple Calendar,
 * which both subscribe to a plain ICS URL — no OAuth app, no CalDAV, and
 * nothing that only works for one vendor.
 *
 * A subscribed calendar re-fetches on the client's own schedule (Google is
 * measured in hours, Apple lets the user pick), so this is the "my week at a
 * glance" channel. Anything urgent — an approval, a cancellation — goes out
 * over email and push, which are immediate.
 */

const { to12Hour } = require('../utils/timeFormat');

// Consultations that should appear on a calendar. A declined or cancelled
// booking is not an event; it is the absence of one.
const PUBLISHED_STATUSES = ['pending', 'confirmed', 'completed'];

// Asia/Manila has had no DST since 1978 and no plans to reintroduce it, so a
// fixed offset is correct here. Emitting local times with an explicit VTIMEZONE
// keeps them readable in the client rather than shifted into UTC.
const TZID = 'Asia/Manila';
const TZ_OFFSET = '+0800';

/** RFC 5545 §3.3.11: escape backslash, semicolon, comma and newline. */
function escapeText(value) {
    return String(value === null || value === undefined ? '' : value)
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\r?\n/g, '\\n');
}

/**
 * RFC 5545 §3.1: lines are folded at 75 octets, continued with a leading
 * space. Folding by byte rather than by character matters — a name with an
 * accent in it would otherwise be split mid-codepoint and arrive corrupted.
 */
function foldLine(line) {
    const bytes = Buffer.from(line, 'utf8');
    if (bytes.length <= 75) return line;

    const parts = [];
    let start = 0;
    let limit = 75;

    while (start < bytes.length) {
        let end = Math.min(start + limit, bytes.length);
        // Back off until the slice ends on a whole UTF-8 character
        while (end > start && end < bytes.length && (bytes[end] & 0xC0) === 0x80) end--;
        parts.push(bytes.slice(start, end).toString('utf8'));
        start = end;
        limit = 74;   // continuation lines carry a leading space
    }
    return parts.join('\r\n ');
}

/** 'YYYY-MM-DD' + 'HH:MM:SS' -> '20260827T140000' (floating local time). */
function localStamp(date, time) {
    const day = String(date).slice(0, 10).replace(/-/g, '');
    const clock = String(time).slice(0, 8).replace(/:/g, '');
    return `${day}T${clock}`;
}

/** A UTC stamp, for DTSTAMP and the feed's own bookkeeping. */
function utcStamp(value) {
    const d = value ? new Date(value) : new Date();
    const safe = Number.isNaN(d.getTime()) ? new Date() : d;
    return safe.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * A stable, globally unique id for one appointment.
 *
 * Stability is the whole point: re-publishing the same UID lets the subscriber
 * update the event in place. A UID that changed per fetch would leave the
 * instructor with a duplicate every time their calendar refreshed.
 */
function uid(kind, id, host) {
    return `facitrack-${kind}-${id}@${host}`;
}

/** Google and Apple both surface STATUS; a pending request is not confirmed. */
function icsStatus(status) {
    if (status === 'confirmed' || status === 'completed') return 'CONFIRMED';
    if (status === 'pending') return 'TENTATIVE';
    return 'CANCELLED';
}

function fold(lines) {
    return lines.map(foldLine).join('\r\n');
}

/**
 * The timezone definition. Without it clients guess, and a 2pm consultation can
 * land at 6am for anyone whose device is set elsewhere.
 */
function vtimezone() {
    return [
        'BEGIN:VTIMEZONE',
        `TZID:${TZID}`,
        'BEGIN:STANDARD',
        'DTSTART:19700101T000000',
        `TZOFFSETFROM:${TZ_OFFSET}`,
        `TZOFFSETTO:${TZ_OFFSET}`,
        'TZNAME:PST',
        'END:STANDARD',
        'END:VTIMEZONE',
    ];
}

/**
 * One consultation as a VEVENT.
 *
 * @param {object} row      an appointment joined to its consultation hour
 * @param {object} opts
 * @param {'instructor'|'student'} opts.audience  whose feed this is
 * @param {string} opts.host                      for the UID domain
 */
function appointmentEvent(row, { audience, host }) {
    const date = String(row.consultation_date).slice(0, 10);
    const start = localStamp(date, row.start_time);
    const end = localStamp(date, row.end_time);

    const counterpart = audience === 'instructor'
        ? `${row.student_first_name} ${row.student_last_name}`
        : `${row.instructor_first_name} ${row.instructor_last_name}`;

    const summary = row.status === 'pending'
        ? `[Pending] Consultation — ${counterpart}`
        : `Consultation — ${counterpart}`;

    // Where it happens: a room for face-to-face, the meeting link for online
    const location = row.mode === 'Online'
        ? (row.meeting_link || 'Online')
        : [row.room_number, row.building_name].filter(Boolean).join(', ');

    const description = [
        row.topic ? `Topic: ${row.topic}` : null,
        row.course_subject ? `Subject: ${row.course_subject}` : null,
        row.section_group_name ? `Section: ${row.section_group_name}` : null,
        audience === 'instructor' && row.student_number ? `Student No.: ${row.student_number}` : null,
        `Mode: ${row.mode}`,
        `Duration: ${durationMinutes(row.start_time, row.end_time)} minutes ` +
            `(${to12Hour(String(row.start_time).slice(0, 5))} – ${to12Hour(String(row.end_time).slice(0, 5))})`,
        `Status: ${row.status}`,
        row.notes ? `Notes: ${row.notes}` : null,
    ].filter(Boolean).join('\n');

    const lines = [
        'BEGIN:VEVENT',
        `UID:${uid('apt', row.id, host)}`,
        `DTSTAMP:${utcStamp(row.created_at)}`,
        `DTSTART;TZID=${TZID}:${start}`,
        `DTEND;TZID=${TZID}:${end}`,
        `SUMMARY:${escapeText(summary)}`,
        `DESCRIPTION:${escapeText(description)}`,
        `STATUS:${icsStatus(row.status)}`,
        // Consultations occupy the instructor; they should show as busy
        'TRANSP:OPAQUE',
        `SEQUENCE:${row.status === 'pending' ? 0 : 1}`,
    ];
    if (location) lines.push(`LOCATION:${escapeText(location)}`);
    if (row.mode === 'Online' && row.meeting_link) lines.push(`URL:${escapeText(row.meeting_link)}`);

    // A quarter-hour warning, which is what makes the subscription worth having
    lines.push(
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        'TRIGGER:-PT15M',
        `DESCRIPTION:${escapeText(summary)}`,
        'END:VALARM',
        'END:VEVENT'
    );
    return lines;
}

/**
 * One instructor-authored event or task as a VEVENT.
 *
 * An all-day entry uses DATE values with an exclusive DTEND, which is what the
 * spec requires and what the import side already assumes — the same rule read
 * from the other end.
 */
function ownEvent(row, { host }) {
    const date = String(row.event_date).slice(0, 10);
    const compact = date.replace(/-/g, '');

    const lines = [
        'BEGIN:VEVENT',
        `UID:${uid('own', row.id, host)}`,
        `DTSTAMP:${utcStamp(row.created_at)}`,
    ];

    if (row.all_day) {
        // DTEND is exclusive for a DATE value, so a one-day event ends on the
        // NEXT day. Built in UTC on purpose: `new Date('2026-09-02T00:00:00')`
        // is parsed as local, and toISOString() would then hand back the day
        // before in Asia/Manila — leaving DTEND equal to DTSTART.
        const [y, m, d] = date.split('-').map(Number);
        const next = new Date(Date.UTC(y, m - 1, d + 1));
        lines.push(
            `DTSTART;VALUE=DATE:${compact}`,
            `DTEND;VALUE=DATE:${next.toISOString().slice(0, 10).replace(/-/g, '')}`
        );
    } else {
        lines.push(
            `DTSTART;TZID=${TZID}:${compact}T${slotClock(row.start_slot)}`,
            `DTEND;TZID=${TZID}:${compact}T${slotClock(row.end_slot)}`
        );
    }

    const prefix = row.kind === 'task' ? (row.done ? '[Done] ' : '[Task] ') : '';
    lines.push(
        `SUMMARY:${escapeText(prefix + row.title)}`,
        // A non-blocking entry is FREE, so a subscribed calendar shows it
        // without making the instructor look busy to anyone reading it
        `TRANSP:${row.blocks ? 'OPAQUE' : 'TRANSPARENT'}`,
        `STATUS:${row.kind === 'task' && row.done ? 'CANCELLED' : 'CONFIRMED'}`
    );
    if (row.notes) lines.push(`DESCRIPTION:${escapeText(row.notes)}`);

    lines.push('END:VEVENT');
    return lines;
}

/** Half-hour index -> 'HHMMSS'. */
function slotClock(slot) {
    const mins = Number(slot) * 30;
    return String(Math.floor(mins / 60)).padStart(2, '0') +
           String(mins % 60).padStart(2, '0') + '00';
}

function durationMinutes(startTime, endTime) {
    const [sh, sm] = String(startTime).split(':').map(Number);
    const [eh, em] = String(endTime).split(':').map(Number);
    return (eh * 60 + em) - (sh * 60 + sm);
}

/**
 * Build the whole calendar.
 *
 * @param {Array}  rows      appointment rows
 * @param {object} opts
 * @param {'instructor'|'student'} opts.audience
 * @param {string} opts.ownerName  shown as the calendar's name in the client
 * @param {string} opts.host
 */
function buildCalendar(rows, { audience, ownerName, host, ownEvents = [] }) {
    const name = audience === 'instructor'
        ? `FaciTrack Consultations — ${ownerName}`
        : `FaciTrack Appointments — ${ownerName}`;

    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//CSPC//FaciTrack//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        `X-WR-CALNAME:${escapeText(name)}`,
        `X-WR-CALDESC:${escapeText('Consultation schedule published by FaciTrack.')}`,
        `X-WR-TIMEZONE:${TZID}`,
        // Apple honours this as a refresh hint; Google ignores it and uses its own
        'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
        'X-PUBLISHED-TTL:PT1H',
        ...vtimezone(),
    ];

    rows
        .filter(row => PUBLISHED_STATUSES.includes(row.status))
        .forEach(row => lines.push(...appointmentEvent(row, { audience, host })));

    // The instructor's own entries ride in the same feed — one subscription
    // gives them consultations and personal events together.
    ownEvents.forEach(row => lines.push(...ownEvent(row, { host })));

    lines.push('END:VCALENDAR');
    return fold(lines) + '\r\n';
}

module.exports = {
    buildCalendar,
    PUBLISHED_STATUSES,
    // exported for tests
    escapeText,
    foldLine,
};
