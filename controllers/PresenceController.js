const crypto = require('crypto');
const PresenceModel = require('../models/PresenceModel');
const appSettings = require('../services/app-settings');
const { broadcast } = require('../realtime/sseRegistry');

/**
 * Takes what the room scanners heard and decides who is where.
 *
 * The scanners have no session — they are devices on the campus network — so
 * this endpoint authenticates with a shared secret instead. That secret is the
 * only thing standing between the network and forged presence data, so it is
 * compared in constant time and the endpoint says as little as possible when it
 * fails.
 */

const MAC_RE = /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/;

/** Constant-time compare, so a wrong key cannot be found one character at a time. */
function keyMatches(supplied) {
    const expected = process.env.PRESENCE_INGEST_KEY;
    if (!expected || !supplied) return false;

    const a = Buffer.from(String(supplied));
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

/** Pull the usable sightings out of whatever the scanner sent. */
function parseBeacons(raw) {
    if (!Array.isArray(raw)) return [];

    const seen = new Set();
    const out = [];
    for (const entry of raw) {
        if (!entry || typeof entry !== 'object') continue;

        const mac = String(entry.id || '').trim().toLowerCase();
        if (!MAC_RE.test(mac) || seen.has(mac)) continue;

        const rssi = Number(entry.rssi);
        if (!Number.isFinite(rssi) || rssi > 0 || rssi < -127) continue;

        const major = Number.isInteger(Number(entry.major)) ? Number(entry.major) : null;
        const minor = Number.isInteger(Number(entry.minor)) ? Number(entry.minor) : null;

        seen.add(mac);
        out.push({ mac, rssi, lastSeenMs: Number(entry.lastSeenMs) || 0, major, minor });
    }
    return out;
}

const PresenceController = {

    /**
     * POST /api/presence/ingest
     * Body: { room, scanner, uptimeSec, beacons: [{ id, rssi, lastSeenMs }] }
     */
    async ingest(req, res) {
        if (!keyMatches(req.get('X-Presence-Key'))) {
            return res.status(401).json({ success: false, error: 'Unauthorized.' });
        }

        const roomNumber = String(req.body?.room || '').trim();
        const scannerId = String(req.body?.scanner || '').trim().slice(0, 60) || null;
        if (!roomNumber) {
            return res.status(400).json({ success: false, error: 'A room is required.' });
        }

        try {
            const room = await PresenceModel.getRoomByNumber(roomNumber);
            if (!room) {
                // Worth being explicit: this is the mistake an installer makes,
                // and it shows up on the scanner's serial monitor.
                return res.status(404).json({
                    success: false,
                    error: `No room named "${roomNumber}". Check ROOM_CODE against Admin → Rooms.`,
                });
            }

            const sightings = parseBeacons(req.body?.beacons);
            const [defaultThreshold, absentAfter, logging, scannerStaleAfter] = await Promise.all([
                appSettings.get('presence_rssi_threshold'),
                appSettings.get('presence_absent_after_sec'),
                appSettings.get('presence_logging_enabled'),
                appSettings.get('presence_scanner_offline_after_sec'),
            ]);

            // A room tuned individually wins over the system-wide default: a
            // large laboratory and a small consultation room do not share a
            // sensible cutoff.
            const threshold = room.rssi_threshold !== null && room.rssi_threshold !== undefined
                ? room.rssi_threshold
                : defaultThreshold;

            // Remember the scanner itself, so a room going dark is visible as a
            // stale scanner rather than as tags that mysteriously went quiet.
            const scanner = await PresenceModel.recordScanner(scannerId, room.id, {
                uptimeSec: Number(req.body?.uptimeSec) || null,
                beaconCount: sightings.length,
                ip: req.ip,
                staleAfterSeconds: scannerStaleAfter,
            });

            // Every tag heard is recorded, so a brand new one appears in Admin
            // ready to be assigned even before anybody owns it.
            await PresenceModel.recordSightings(sightings, room.id);

            // Only tags strong enough to be in this room, rather than passing
            // by in the corridor, count towards presence.
            const inRoom = sightings.filter(s => s.rssi >= threshold);
            const beacons = await PresenceModel.getBeaconsByMac(inRoom.map(s => s.mac));

            const rssiByMac = new Map(inRoom.map(s => [s.mac, s.rssi]));
            const assigned = beacons.filter(b => b.instructor_id && b.is_active);

            const current = await PresenceModel.getCurrent(assigned.map(b => b.instructor_id));
            const events = [];

            for (const beacon of assigned) {
                await PresenceModel.markPresent(beacon.instructor_id, room.id);

                const before = current.get(beacon.instructor_id);
                const wasHere = before && before.is_present && before.room_id === room.id;
                if (wasHere) continue;   // still in the same room, nothing to log

                events.push({
                    instructorId: beacon.instructor_id,
                    roomId: room.id,
                    event: before && before.is_present ? 'moved' : 'entered',
                    rssi: rssiByMac.get(beacon.mac_address),
                    scannerId,
                });
            }

            // Nothing announces a departure, so absence is a timeout. Sweeping
            // on every post keeps it self-healing while any scanner is alive.
            const departed = await PresenceModel.expireStale(absentAfter);
            for (const row of departed) {
                events.push({ instructorId: row.instructor_id, roomId: row.room_id, event: 'exited', scannerId });
            }

            if (logging && events.length) await PresenceModel.log(events);

            // Open dean and admin pages update without a reload. One message
            // carries the whole batch: a room with several people arriving at
            // once should wake every listener a single time, not once each.
            // A scanner coming back after going quiet is news for the health
            // page even when nobody is in the room, and nothing else would
            // ever announce it — going silent produces no report at all.
            if (events.length || scanner.wasStale) {
                try {
                    broadcast('presence:changed', {
                        room: room.room_number,
                        roomId: room.id,
                        scannerId,
                        at: new Date().toISOString(),
                        events: events.map(e => ({ instructorId: e.instructorId, event: e.event })),
                    });
                } catch (err) {
                    console.error('[Presence] Broadcast failed:', err.message);
                }
            }

            res.json({
                success: true,
                room: room.room_number,
                heard: sightings.length,
                inRoom: inRoom.length,
                recognised: assigned.length,
                unassigned: beacons.filter(b => !b.instructor_id).length,
                events: events.length,
                threshold,
                // Says which number was applied, so a scanner's serial log
                // shows whether this room is tuned or on the default
                thresholdSource: room.rssi_threshold !== null && room.rssi_threshold !== undefined ? 'room' : 'default',
            });
        } catch (err) {
            console.error('[Presence.ingest]', err);
            res.status(500).json({ success: false, error: 'Could not record presence.' });
        }
    },

    /** GET /api/presence/health — lets an installer confirm the URL and key. */
    async health(req, res) {
        if (!keyMatches(req.get('X-Presence-Key'))) {
            return res.status(401).json({ success: false, error: 'Unauthorized.' });
        }
        res.json({ success: true, serverTime: new Date().toISOString() });
    },
};

module.exports = PresenceController;
