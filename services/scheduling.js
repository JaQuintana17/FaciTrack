function normalizeDateKey(value) {
  if (!value) return null;
  const dt = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(dt.getTime())) return null;
  const year = dt.getFullYear();
  const month = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getBlockDateKeys(startDate, endDate) {
  const start = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T00:00:00');
  const dates = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    dates.push(normalizeDateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function parseTimeToMinutes(value) {
  if (!value) return null;
  const raw = String(value).trim();
  const simpleMatch = raw.match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i);
  const suffixedMatch = raw.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  const match = suffixedMatch || simpleMatch;
  if (!match) return null;
  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const suffix = (match[3] || 'AM').toUpperCase();
  if (suffix === 'PM' && hours !== 12) hours += 12;
  if (suffix === 'AM' && hours === 12) hours = 0;
  return hours * 60 + minutes;
}

function bookingConflictsWithBlock(booking, block, blockDateKey) {
  if (!booking || !block) return false;
  if (normalizeDateKey(booking.date) !== blockDateKey) return false;

  if (block.type === 'full-day') return true;
  if (block.type !== 'time-range') return false;

  const bookingSlot = String(booking.slot || '');
  const slotMatch = bookingSlot.match(/^(\d{1,2}:\d{2})\s*(AM|PM)\s*[-–]\s*(\d{1,2}:\d{2})\s*(AM|PM)$/i);
  if (!slotMatch) return false;

  const startMinutes = parseTimeToMinutes(`${slotMatch[1]} ${slotMatch[2]}`);
  const endMinutes = parseTimeToMinutes(`${slotMatch[3]} ${slotMatch[4]}`);
  const blockStart = parseTimeToMinutes(`${block.startTime}`);
  const blockEnd = parseTimeToMinutes(`${block.endTime}`);

  if (startMinutes === null || endMinutes === null || blockStart === null || blockEnd === null) return false;
  return startMinutes < blockEnd && endMinutes > blockStart;
}


// ── What counts as a slot being taken ──
//
// Cancelled, declined and rescheduled appointments release their slot: a
// rescheduled booking has already moved somewhere else, so the original hour
// is free again. Everything else still holds it.
//
// This list must be the ONLY answer to "is this slot taken?". The booking
// calendar and the create path used to define it differently — the calendar
// offered a slot whose appointment had been rescheduled, then the submit
// refused it as already booked.
const SLOT_HOLDING_STATUSES = ['pending', 'confirmed', 'completed'];

/** The same list as a SQL fragment, for embedding in an IN (...) clause. */
const SLOT_HOLDING_SQL = SLOT_HOLDING_STATUSES.map(s => `'${s}'`).join(', ');

// A narrower question, and a different one: which bookings are still live —
// awaiting an answer or due to happen — so can be cancelled, declined or
// rescheduled. A completed consultation holds its slot but is not live: it
// already happened and must never be declined out from under the student.
const LIVE_APPOINTMENT_STATUSES = ['pending', 'confirmed'];
const LIVE_APPOINTMENT_SQL = LIVE_APPOINTMENT_STATUSES.map(s => `'${s}'`).join(', ');

// ── Booking lead time ──
// Students may book same-day, but not a slot starting within this many hours.
// The administrator sets this in System Settings; .env is the fallback for an
// install that has never opened that page.
const BOOKING_LEAD_TIME_HOURS = Number(process.env.BOOKING_LEAD_TIME_HOURS) || 4;

/** The configured lead time. Async because the stored value wins over .env. */
async function bookingLeadTimeHours() {
  const settings = require('./app-settings');
  return settings.get('booking_lead_time_hours');
}

/** Earliest instant a slot may start and still be bookable. */
function earliestBookableStart(now = new Date(), leadHours = BOOKING_LEAD_TIME_HOURS) {
  return new Date(now.getTime() + leadHours * 60 * 60 * 1000);
}

/**
 * True when a slot starts too soon to book.
 * @param {string} dateKey   YYYY-MM-DD
 * @param {string} startTime HH:MM or HH:MM:SS (24h)
 * @param {number} leadHours defaults to the .env value; pass the configured one
 */
function isWithinLeadTime(dateKey, startTime, now = new Date(), leadHours = BOOKING_LEAD_TIME_HOURS) {
  const mins = toMinutesOfDay(startTime);
  if (mins === null) return false;
  const parts = String(dateKey).slice(0, 10).split("-").map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return false;
  const slotStart = new Date(parts[0], parts[1] - 1, parts[2], Math.floor(mins / 60), mins % 60, 0, 0);
  return slotStart < earliestBookableStart(now, leadHours);
}

/**
 * Minutes past midnight from either a 24h DB time ("14:30:00", "14:30")
 * or a 12h display time ("2:30 PM"). parseTimeToMinutes only accepts the
 * latter and returns null on the seconds suffix MySQL sends back.
 */
function toMinutesOfDay(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (/(AM|PM)$/i.test(raw)) return parseTimeToMinutes(raw);
  const m = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return parseTimeToMinutes(raw);
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

module.exports = {
  normalizeDateKey,
  getBlockDateKeys,
  parseTimeToMinutes,
  bookingConflictsWithBlock,
  SLOT_HOLDING_STATUSES,
  SLOT_HOLDING_SQL,
  LIVE_APPOINTMENT_STATUSES,
  LIVE_APPOINTMENT_SQL,
  BOOKING_LEAD_TIME_HOURS,
  bookingLeadTimeHours,
  earliestBookableStart,
  isWithinLeadTime,
  toMinutesOfDay
};