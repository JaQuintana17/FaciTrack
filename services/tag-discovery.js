const AppSettingModel = require('../models/AppSettingModel');

/**
 * The window during which unknown tags are written down.
 *
 * Outside it the ingest updates tags it already knows and ignores everything
 * else. That is the fix for a table that had grown to 164 rows of which one
 * was a real tag: the scanner hears every phone in the corridor, and most of
 * those addresses rotate, so storing them was both unbounded and pointless.
 * It also means the system stops keeping a record of everyone who walks past
 * with Bluetooth on, which it has no business holding.
 *
 * State lives in app_settings but deliberately NOT in services/app-settings.js:
 * that module caches for 15 seconds and describes durable configuration an
 * admin sets on a form. This is neither — it is a two-minute window someone is
 * standing in front of a scanner waiting on, so it is read straight through.
 */

const UNTIL_KEY = 'presence_discovery_until';   // epoch ms, as a string
const ROOM_KEY = 'presence_discovery_room';     // room id, or '' for anywhere

const MIN_MINUTES = 1;
const MAX_MINUTES = 15;
const DEFAULT_MINUTES = 3;

function clampMinutes(minutes) {
    const n = Number(minutes);
    if (!Number.isFinite(n)) return DEFAULT_MINUTES;
    return Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, Math.round(n)));
}

/**
 * Open the window.
 *
 * Bounded at fifteen minutes and never "until I turn it off": the failure this
 * guards against is somebody opening discovery, being called away, and leaving
 * the system logging passers-by for a fortnight.
 */
async function open({ roomId = null, minutes = DEFAULT_MINUTES, adminInternalId = null } = {}) {
    const span = clampMinutes(minutes);
    const until = Date.now() + span * 60 * 1000;

    await AppSettingModel.set(UNTIL_KEY, String(until), adminInternalId);
    await AppSettingModel.set(ROOM_KEY, roomId ? String(roomId) : '', adminInternalId);

    return { until, minutes: span, roomId: roomId || null };
}

async function close(adminInternalId = null) {
    await AppSettingModel.set(UNTIL_KEY, '0', adminInternalId);
    await AppSettingModel.set(ROOM_KEY, '', adminInternalId);
}

/** Whether the window is open, and for how much longer. */
async function status() {
    const [rawUntil, rawRoom] = await Promise.all([
        AppSettingModel.get(UNTIL_KEY, '0'),
        AppSettingModel.get(ROOM_KEY, ''),
    ]);

    const until = Number(rawUntil) || 0;
    const msLeft = until - Date.now();
    const roomId = rawRoom ? Number(rawRoom) : null;

    return {
        open: msLeft > 0,
        until: until || null,
        secondsLeft: msLeft > 0 ? Math.ceil(msLeft / 1000) : 0,
        roomId: msLeft > 0 ? roomId : null,
    };
}

/**
 * Should this room record tags it does not recognise right now?
 *
 * A window opened for one room does not licence every other scanner on campus
 * to start collecting addresses — the installer is standing in one place.
 */
async function isOpenFor(roomId) {
    const state = await status();
    if (!state.open) return false;
    if (state.roomId === null) return true;      // opened for anywhere
    return Number(roomId) === state.roomId;
}

module.exports = {
    open,
    close,
    status,
    isOpenFor,
    MIN_MINUTES,
    MAX_MINUTES,
    DEFAULT_MINUTES,
};
