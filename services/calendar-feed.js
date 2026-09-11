/**
 * Calendar feed subscription (ICS / iCalendar).
 *
 * One code path serves Google Calendar, Apple Calendar and anything else that
 * publishes an .ics URL — the format is the common denominator, so there is no
 * per-provider client to keep alive.
 *
 * Fetching is deliberately hand-rolled rather than handed to a library: the URL
 * comes from a user, so it has to be checked before the server will follow it.
 */

const dns = require('dns').promises;
const net = require('net');
const ical = require('node-ical');

const { toWallClock, allDayDate, coveringSlots, addDays } = require('../utils/wallClock');

const FETCH_TIMEOUT_MS = Number(process.env.CALENDAR_FETCH_TIMEOUT_MS) || 15000;
const MAX_FEED_BYTES = Number(process.env.CALENDAR_MAX_FEED_BYTES) || 5 * 1024 * 1024;
const MAX_REDIRECTS = 3;

// How far around today events are imported. Past events are useless for
// booking, and an unbounded future turns a yearly repeat into thousands of rows.
const WINDOW_BACK_DAYS = Number(process.env.CALENDAR_WINDOW_BACK_DAYS) || 7;
const WINDOW_AHEAD_DAYS = Number(process.env.CALENDAR_WINDOW_AHEAD_DAYS) || 120;

class FeedError extends Error {
    constructor(message, { retryable = true } = {}) {
        super(message);
        this.retryable = retryable;
    }
}

// ── URL safety ─────────────────────────────────────────────────────────────

/** webcal:// is what Google and Apple hand out; it is plain https underneath. */
function normalizeFeedUrl(raw) {
    const text = String(raw || '').trim();
    if (!text) throw new FeedError('Paste the calendar address first.', { retryable: false });

    let url;
    try {
        url = new URL(text.replace(/^webcal:\/\//i, 'https://'));
    } catch (_) {
        throw new FeedError('That does not look like a web address.', { retryable: false });
    }

    if (url.protocol !== 'https:') {
        throw new FeedError('The calendar address must start with https:// or webcal://', { retryable: false });
    }
    return url;
}

/**
 * Refuse addresses that point back inside our own network.
 *
 * Without this the instructor could make the server fetch its own database
 * port or a cloud metadata endpoint and read the reply. Note this checks the
 * addresses DNS returns now; a name that changes answers between this check
 * and the request could still slip through, which is why https is required
 * and the response is never echoed back verbatim.
 */
function isPrivateAddress(ip) {
    if (net.isIPv4(ip)) {
        const [a, b] = ip.split('.').map(Number);
        if (a === 10 || a === 127 || a === 0) return true;
        if (a === 172 && b >= 16 && b <= 31) return true;
        if (a === 192 && b === 168) return true;
        if (a === 169 && b === 254) return true;       // link-local / metadata
        if (a === 100 && b >= 64 && b <= 127) return true;  // carrier NAT
        if (a >= 224) return true;                     // multicast / reserved
        return false;
    }
    const ip6 = ip.toLowerCase().replace(/^\[|\]$/g, '');
    if (ip6 === '::1' || ip6 === '::') return true;
    if (ip6.startsWith('fe80') || ip6.startsWith('fc') || ip6.startsWith('fd')) return true;
    if (ip6.startsWith('::ffff:')) return isPrivateAddress(ip6.slice(7));
    return false;
}

async function assertPublicHost(hostname) {
    // A literal IP never reaches DNS, so check it directly
    if (net.isIP(hostname)) {
        if (isPrivateAddress(hostname)) {
            throw new FeedError('That address is not reachable from here.', { retryable: false });
        }
        return;
    }

    let records;
    try {
        records = await dns.lookup(hostname, { all: true });
    } catch (_) {
        throw new FeedError(`Could not find ${hostname}.`, { retryable: false });
    }
    if (!records.length || records.some(r => isPrivateAddress(r.address))) {
        throw new FeedError('That address is not reachable from here.', { retryable: false });
    }
}

// ── Fetching ───────────────────────────────────────────────────────────────

/** Read a response body, refusing anything oversized without buffering it all. */
async function readCapped(response) {
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_FEED_BYTES) {
        throw new FeedError('That calendar is too large to import.', { retryable: false });
    }

    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > MAX_FEED_BYTES) {
            await reader.cancel();
            throw new FeedError('That calendar is too large to import.', { retryable: false });
        }
        chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
}

/**
 * Fetch a feed, following redirects by hand so every hop is re-checked.
 * `etag`/`lastModified` from the previous sync make an unchanged feed a
 * cheap 304 instead of a full download.
 */
async function fetchFeed(rawUrl, { etag, lastModified } = {}) {
    let url = normalizeFeedUrl(rawUrl);

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        await assertPublicHost(url.hostname);

        const headers = { 'User-Agent': 'FaciTrack/1.0 (calendar sync)', Accept: 'text/calendar, text/plain' };
        if (etag) headers['If-None-Match'] = etag;
        if (lastModified) headers['If-Modified-Since'] = lastModified;

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

        let response;
        try {
            response = await fetch(url, { headers, redirect: 'manual', signal: controller.signal });
        } catch (err) {
            throw new FeedError(err.name === 'AbortError'
                ? 'The calendar took too long to respond.'
                : 'Could not reach that calendar.');
        } finally {
            clearTimeout(timer);
        }

        if (response.status === 304) return { unchanged: true };

        if ([301, 302, 303, 307, 308].includes(response.status)) {
            const location = response.headers.get('location');
            if (!location) throw new FeedError('That calendar redirected nowhere.', { retryable: false });
            url = normalizeFeedUrl(new URL(location, url).toString());
            continue;
        }

        if (response.status === 401 || response.status === 403) {
            throw new FeedError('That calendar is private. Use its secret or public address.', { retryable: false });
        }
        if (response.status === 404) {
            throw new FeedError('That calendar address no longer exists.', { retryable: false });
        }
        if (!response.ok) {
            throw new FeedError(`The calendar server answered ${response.status}.`);
        }

        const body = await readCapped(response);
        if (!/BEGIN:VCALENDAR/i.test(body)) {
            throw new FeedError('That address did not return a calendar.', { retryable: false });
        }

        return {
            unchanged: false,
            body,
            etag: response.headers.get('etag'),
            lastModified: response.headers.get('last-modified'),
        };
    }

    throw new FeedError('That calendar redirected too many times.', { retryable: false });
}

// ── Parsing ────────────────────────────────────────────────────────────────

/**
 * Every occurrence of one VEVENT inside the window, as absolute instants.
 * Repeating events are expanded here; a feed only states the rule.
 */
function expandOccurrences(event, windowStart, windowEnd) {
    const duration = (event.end && event.start)
        ? Math.max(0, event.end.getTime() - event.start.getTime())
        : 0;

    if (!event.rrule) {
        return (event.start >= windowStart && event.start <= windowEnd)
            ? [{ start: event.start, end: event.end || event.start, base: event.start }]
            : [];
    }

    // A modified or deleted instance of a repeat is listed separately
    const overrides = event.recurrences || {};
    const excluded = new Set(Object.values(event.exdate || {})
        .map(d => new Date(d).toDateString()));

    const out = [];
    for (const start of event.rrule.between(windowStart, windowEnd, true)) {
        if (excluded.has(start.toDateString())) continue;

        const key = Object.keys(overrides).find(k =>
            new Date(overrides[k].start).toDateString() === start.toDateString() ||
            new Date(k).toDateString() === start.toDateString());

        if (key) {
            const moved = overrides[key];
            if (String(moved.status).toUpperCase() === 'CANCELLED') continue;
            out.push({ start: moved.start, end: moved.end || moved.start, base: start });
        } else {
            out.push({ start, end: new Date(start.getTime() + duration), base: start });
        }
    }
    return out;
}

/**
 * One occurrence → the rows FaciTrack stores. An event crossing midnight
 * becomes one row per day so the date + slot model still holds.
 */
function toRows(occurrence, event, allDay) {
    const rows = [];

    if (allDay) {
        // DTEND on an all-day event is exclusive: it names the morning after
        const first = allDayDate(occurrence.start);
        const lastExclusive = occurrence.end ? allDayDate(occurrence.end) : first;
        let day = first;
        for (let guard = 0; guard < 60; guard++) {
            rows.push({ date: day, startSlot: null, endSlot: null, allDay: true, occurrence: day });
            const next = addDays(day, 1);
            if (next >= lastExclusive) break;
            day = next;
        }
        return rows;
    }

    const from = toWallClock(occurrence.start);
    const to = toWallClock(occurrence.end && occurrence.end > occurrence.start
        ? occurrence.end : new Date(occurrence.start.getTime() + 30 * 60000));

    if (from.date === to.date) {
        const { startSlot, endSlot } = coveringSlots(from.hour, from.minute, to.hour, to.minute);
        rows.push({
            date: from.date, startSlot, endSlot, allDay: false,
            occurrence: `${from.date}T${String(from.hour).padStart(2, '0')}:${String(from.minute).padStart(2, '0')}`,
        });
        return rows;
    }

    // Crosses midnight: fill the first day to 24:00, whole days, then the tail
    let day = from.date;
    let cursorStart = coveringSlots(from.hour, from.minute, 24, 0).startSlot;
    for (let guard = 0; guard < 60; guard++) {
        const isLast = day === to.date;
        const endSlot = isLast
            ? coveringSlots(0, 0, to.hour, to.minute).endSlot
            : 48;
        if (endSlot > cursorStart) {
            rows.push({
                date: day, startSlot: cursorStart, endSlot, allDay: false,
                occurrence: `${day}T${String(Math.floor(cursorStart / 2)).padStart(2, '0')}:${cursorStart % 2 ? '30' : '00'}`,
            });
        }
        if (isLast) break;
        day = addDays(day, 1);
        cursorStart = 0;
    }
    return rows;
}

/**
 * A feed body → normalised event rows inside the import window.
 * Nothing here touches the database; the model decides what to keep.
 */
function parseFeed(body, { now = new Date() } = {}) {
    let parsed;
    try {
        parsed = ical.sync.parseICS(body);
    } catch (_) {
        throw new FeedError('That calendar could not be read.', { retryable: false });
    }

    const windowStart = new Date(now.getTime() - WINDOW_BACK_DAYS * 86400000);
    const windowEnd = new Date(now.getTime() + WINDOW_AHEAD_DAYS * 86400000);

    const rows = [];
    for (const key of Object.keys(parsed)) {
        const event = parsed[key];
        if (!event || event.type !== 'VEVENT' || !event.start) continue;
        if (String(event.status).toUpperCase() === 'CANCELLED') continue;

        const allDay = event.datetype === 'date';
        const transparent = String(event.transparency).toUpperCase() === 'TRANSPARENT';

        for (const occurrence of expandOccurrences(event, windowStart, windowEnd)) {
            for (const row of toRows(occurrence, event, allDay)) {
                rows.push(Object.assign(row, {
                    uid: String(event.uid || key).slice(0, 255),
                    summary: event.summary ? String(event.summary).slice(0, 255) : null,
                    location: event.location ? String(event.location).slice(0, 255) : null,
                    transparent,
                }));
            }
        }
    }
    return rows;
}

/**
 * Google Calendar API events → the rows external_events stores.
 *
 * Deliberately routed through the same toRows() the ICS path uses, so a
 * midnight-crossing event, an all-day event and the outward slot rounding
 * behave identically no matter which source the event came from. Two readers
 * that split days differently would be two sets of bugs.
 */
function fromGoogleEvents(events) {
    const rows = [];

    for (const event of events || []) {
        if (!event || !event.start) continue;
        if (String(event.status).toLowerCase() === 'cancelled') continue;

        // Skip the consultations FaciTrack itself put on this calendar —
        // reading our own writes back would double them on the calendar view
        // and block the slot they already occupy.
        if (event.extendedProperties?.private?.facitrack) continue;

        const allDay = Boolean(event.start.date);
        let occurrence;

        if (allDay) {
            // Google's all-day end.date is exclusive, matching ICS DTEND,
            // which is what toRows already expects.
            occurrence = { start: event.start.date, end: event.end?.date || null };
        } else {
            const start = new Date(event.start.dateTime);
            if (Number.isNaN(start.getTime())) continue;
            const end = event.end?.dateTime ? new Date(event.end.dateTime) : null;
            occurrence = { start, end: end && !Number.isNaN(end.getTime()) ? end : null };
        }

        const transparent = String(event.transparency).toLowerCase() === 'transparent';

        for (const row of toRows(occurrence, event, allDay)) {
            rows.push(Object.assign(row, {
                uid: String(event.iCalUID || event.id || '').slice(0, 255),
                summary: event.summary ? String(event.summary).slice(0, 255) : null,
                location: event.location ? String(event.location).slice(0, 255) : null,
                transparent,
            }));
        }
    }

    return rows;
}

module.exports = {
    FeedError,
    fromGoogleEvents,
    normalizeFeedUrl,
    isPrivateAddress,
    assertPublicHost,
    fetchFeed,
    parseFeed,
    WINDOW_BACK_DAYS,
    WINDOW_AHEAD_DAYS,
};
