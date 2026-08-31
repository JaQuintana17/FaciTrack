/**
 * Absolute instants → the local wall-clock the rest of FaciTrack stores.
 *
 * Calendar feeds carry absolute instants ("2026-09-01T01:00:00Z"), but every
 * table here stores a naive local date plus half-hour slot indices. These
 * helpers are the single crossing point between the two, so the conversion
 * cannot be done three different ways in three different files.
 */

const APP_TIMEZONE = process.env.APP_TIMEZONE || 'Asia/Manila';

// en-CA formats as YYYY-MM-DD, which is exactly the key format used elsewhere
const DATE_PARTS = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
});

/** An instant → { date: 'YYYY-MM-DD', hour, minute } in the app's timezone. */
function toWallClock(instant) {
    const parts = {};
    for (const part of DATE_PARTS.formatToParts(instant)) parts[part.type] = part.value;
    // Midnight can format as hour "24" in some ICU versions
    const hour = parts.hour === '24' ? 0 : Number(parts.hour);
    return {
        date: `${parts.year}-${parts.month}-${parts.day}`,
        hour,
        minute: Number(parts.minute),
    };
}

/**
 * The calendar date of an all-day event.
 *
 * node-ical builds these at midnight in the *process* timezone, so the local
 * getters give back exactly the date the feed wrote — while toISOString() would
 * shift it a day either side of UTC.
 */
function allDayDate(dateOnlyValue) {
    const d = new Date(dateOnlyValue);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Wall-clock time → half-hour slot index, matching workload_blocks. */
function toSlot(hour, minute) {
    return hour * 2 + (minute >= 30 ? 1 : 0);
}

/**
 * Slot indices covering a wall-clock range, rounded *outward*.
 *
 * A 9:15–9:45 meeting occupies 9:00–10:00 as far as booking is concerned.
 * Rounding inward would leave a bookable gap in the middle of a meeting.
 */
function coveringSlots(startHour, startMinute, endHour, endMinute) {
    const start = toSlot(startHour, startMinute);
    const endExact = endHour * 2 + endMinute / 30;
    return { startSlot: start, endSlot: Math.max(start + 1, Math.ceil(endExact)) };
}

function addDays(dateKey, days) {
    const d = new Date(dateKey + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function todayKey() {
    return toWallClock(new Date()).date;
}

module.exports = {
    APP_TIMEZONE,
    toWallClock,
    allDayDate,
    toSlot,
    coveringSlots,
    addDays,
    todayKey,
};
