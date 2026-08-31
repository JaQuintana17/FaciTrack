function to24Hour(str) {
    const parts = str.trim().split(' ');
    let [h, m] = parts[0].split(':').map(Number);
    const p = parts[1];
    if (p === 'PM' && h !== 12) h += 12;
    if (p === 'AM' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}

function to12Hour(timeStr) {
    const [hStr, mStr] = timeStr.split(':');
    let h = parseInt(hStr);
    const m = mStr;
    const p = h >= 12 ? 'PM' : 'AM';
    if (h > 12) h -= 12;
    if (h === 0) h = 12;
    return `${h}:${m} ${p}`;
}

function toMins(str) {
    const parts = str.trim().split(' ');
    let [h, m] = parts[0].split(':').map(Number);
    const p = parts[1];
    if (p === 'PM' && h !== 12) h += 12;
    if (p === 'AM' && h === 12) h = 0;
    return h * 60 + m;
}

function fromMins(mins) {
    let h = Math.floor(mins / 60);
    const m = mins % 60;
    const p = h >= 12 ? 'PM' : 'AM';
    if (h > 12) h -= 12;
    if (h === 0) h = 12;
    return `${h}:${String(m).padStart(2, '0')} ${p}`;
}

function formatFullDate(dateStr) {
    const d = new Date(dateStr + (dateStr.includes('T') ? '' : 'T00:00:00'));
    return d.toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' });
}

/**
 * "5m ago" for a Date or DATETIME string. Returns null rather than a
 * placeholder so the caller decides what an absent timestamp should read as —
 * "never detected" and "no data yet" are not the same sentence.
 */
function timeAgo(value) {
    if (!value) return null;
    const then = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(then.getTime())) return null;

    const secs = Math.floor((Date.now() - then.getTime()) / 1000);
    if (secs < 60) return 'just now';

    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m ago`;

    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;

    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;

    return then.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
}

module.exports = { to12Hour, to24Hour, toMins, fromMins, formatFullDate, timeAgo };