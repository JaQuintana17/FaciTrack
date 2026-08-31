const pool = require('../configs/db');

/**
 * BLE presence: the scanners, the tags, where they were last heard, and the
 * history.
 *
 * The scanners are dumb on purpose — they report every beacon they heard and
 * how strongly. Everything that decides what a sighting *means* lives here and
 * in PresenceController, so retuning never means re-flashing a board.
 */
const PresenceModel = {

    /**
     * The room a scanner claims to be in. Unknown room codes are rejected.
     * rssi_threshold is NULL unless this room has been tuned individually.
     */
    async getRoomByNumber(roomNumber) {
        const [rows] = await pool.execute(
            'SELECT id, room_number, room_type, rssi_threshold FROM rooms WHERE room_number = ? LIMIT 1',
            [roomNumber]
        );
        return rows[0] || null;
    },

    /** Tune one room, or pass null to put it back on the system-wide default. */
    async setRoomThreshold(roomId, threshold) {
        const [result] = await pool.execute(
            'UPDATE rooms SET rssi_threshold = ? WHERE id = ?', [threshold, roomId]
        );
        return result.affectedRows > 0;
    },

    /** Known tags for the MACs a scanner just reported, with their owner. */
    async getBeaconsByMac(macs) {
        if (!macs.length) return [];
        const [rows] = await pool.query(
            `SELECT b.id, b.mac_address, b.instructor_id, b.label, b.is_active,
                    u.public_id AS instructor_public_id,
                    CONCAT(u.first_name, ' ', u.last_name) AS instructor_name
               FROM ble_beacons b
               LEFT JOIN users u ON u.id = b.instructor_id
              WHERE b.mac_address IN (?)`,
            [macs]
        );
        return rows;
    },

    /**
     * Record every MAC a scanner heard, whether or not it is a known tag.
     *
     * An unrecognised tag is inserted unassigned rather than dropped: that is
     * how a new Minew E8 announces itself, so switching it on is all it takes
     * for it to appear in Admin waiting to be handed to someone.
     */
    async recordSightings(sightings, roomId) {
        if (!sightings.length) return;

        const values = sightings.map(s => [s.mac, roomId, s.rssi, s.major ?? null, s.minor ?? null]);
        await pool.query(
            `INSERT INTO ble_beacons
                 (mac_address, last_room_id, last_rssi, ibeacon_major, ibeacon_minor, last_seen_at)
             VALUES ${values.map(() => '(?, ?, ?, ?, ?, NOW())').join(', ')}
             ON DUPLICATE KEY UPDATE
                 last_room_id  = VALUES(last_room_id),
                 last_rssi     = VALUES(last_rssi),
                 last_seen_at  = VALUES(last_seen_at),
                 ibeacon_major = COALESCE(VALUES(ibeacon_major), ibeacon_major),
                 ibeacon_minor = COALESCE(VALUES(ibeacon_minor), ibeacon_minor)`,
            values.flat()
        );
    },

    /**
     * Remember that a scanner reported. Called on every ingest, so a scanner
     * that goes quiet shows up as a stale row rather than as an absence — which
     * is what makes a silent tag distinguishable from a dead room.
     */
    async recordScanner(scannerId, roomId, { uptimeSec, beaconCount, ip, staleAfterSeconds = 60 } = {}) {
        if (!scannerId) return { wasStale: false, isNew: false };

        // Read the previous state before overwriting it: a scanner that has
        // been silent and is now reporting again is a health change worth
        // announcing, and after the upsert that fact is gone.
        const [[before]] = await pool.execute(
            `SELECT TIMESTAMPDIFF(SECOND, last_seen_at, NOW()) AS secs_since
               FROM ble_scanners WHERE scanner_id = ?`,
            [scannerId]
        );
        const isNew = !before;
        const wasStale = isNew || before.secs_since === null || before.secs_since > staleAfterSeconds;

        await pool.execute(
            `INSERT INTO ble_scanners
                 (scanner_id, room_id, last_seen_at, last_uptime_sec, last_beacon_count, last_ip, report_count)
             VALUES (?, ?, NOW(), ?, ?, ?, 1)
             ON DUPLICATE KEY UPDATE
                 room_id           = VALUES(room_id),
                 last_seen_at      = NOW(),
                 last_uptime_sec   = VALUES(last_uptime_sec),
                 last_beacon_count = VALUES(last_beacon_count),
                 last_ip           = VALUES(last_ip),
                 report_count      = report_count + 1`,
            [scannerId, roomId, uptimeSec ?? null, beaconCount ?? null, ip ?? null]
        );

        return { wasStale, isNew };
    },

    /** Where an instructor is currently recorded, so a change can be detected. */
    async getCurrent(instructorIds) {
        if (!instructorIds.length) return new Map();
        const [rows] = await pool.query(
            'SELECT instructor_id, room_id, is_present FROM faculty_presence WHERE instructor_id IN (?)',
            [instructorIds]
        );
        return new Map(rows.map(r => [r.instructor_id, r]));
    },

    /** Mark an instructor present in a room. One row per instructor, updated in place. */
    async markPresent(instructorId, roomId) {
        await pool.execute(
            `INSERT INTO faculty_presence (instructor_id, room_id, is_present, detected_at)
             VALUES (?, ?, 1, NOW())
             ON DUPLICATE KEY UPDATE
                 room_id     = VALUES(room_id),
                 is_present  = 1,
                 detected_at = NOW()`,
            [instructorId, roomId]
        );
    },

    /**
     * Anyone whose last sighting is older than the cutoff has left.
     *
     * A scanner can only report what it hears, so nothing announces a
     * departure — absence is a timeout. Returns the rows that changed, so the
     * caller can log the exits.
     */
    async expireStale(absentAfterSeconds) {
        const [stale] = await pool.execute(
            `SELECT instructor_id, room_id
               FROM faculty_presence
              WHERE is_present = 1
                AND last_updated < DATE_SUB(NOW(), INTERVAL ? SECOND)`,
            [absentAfterSeconds]
        );
        if (!stale.length) return [];

        await pool.query(
            'UPDATE faculty_presence SET is_present = 0 WHERE instructor_id IN (?)',
            [stale.map(r => r.instructor_id)]
        );
        return stale;
    },

    /** Append-only history. Nothing else writes to this table. */
    async log(entries) {
        if (!entries.length) return;
        const values = entries.map(e => [e.instructorId, e.roomId, e.event, e.rssi ?? null, e.scannerId ?? null]);
        await pool.query(
            `INSERT INTO presence_logs (instructor_id, room_id, event, rssi, scanner_id)
             VALUES ${values.map(() => '(?, ?, ?, ?, ?)').join(', ')}`,
            values.flat()
        );
    },

    /* ── Admin: fleet health ── */

    /**
     * Every scanner, most recently heard first, with the room it claims.
     *
     * Each row carries the room's own threshold and the range of signals it is
     * currently hearing, because a threshold chosen without knowing what the
     * room actually sees is a guess.
     */
    async getScanners(recentSeconds = 300) {
        const [rows] = await pool.query(
            `SELECT s.id, s.scanner_id, s.last_seen_at, s.last_uptime_sec,
                    s.last_beacon_count, s.last_ip, s.report_count, s.first_seen_at,
                    r.id AS room_id, r.room_number, r.room_type, r.rssi_threshold,
                    TIMESTAMPDIFF(SECOND, s.last_seen_at, NOW()) AS secs_since_report,
                    heard.strongest, heard.weakest, heard.tags_heard
               FROM ble_scanners s
               LEFT JOIN rooms r ON r.id = s.room_id
               LEFT JOIN (
                    SELECT last_room_id,
                           MAX(last_rssi) AS strongest,
                           MIN(last_rssi) AS weakest,
                           COUNT(*)       AS tags_heard
                      FROM ble_beacons
                     WHERE last_seen_at > DATE_SUB(NOW(), INTERVAL ? SECOND)
                     GROUP BY last_room_id
               ) heard ON heard.last_room_id = r.id
              ORDER BY s.last_seen_at DESC`,
            [recentSeconds]
        );
        return rows;
    },

    /**
     * Rooms marked in Admin as having a scanner that have never reported — the
     * quickest way to spot one never plugged in, or pointed at the wrong room.
     */
    async getRoomsAwaitingScanner() {
        const [rows] = await pool.query(
            `SELECT r.id, r.room_number, r.room_type
               FROM rooms r
              WHERE r.is_ble_scanner_installed = 1
                AND r.status = 'Active'
                AND NOT EXISTS (SELECT 1 FROM ble_scanners s WHERE s.room_id = r.id)
              ORDER BY r.room_number`
        );
        return rows;
    },

    /* ── Admin: the tags ── */

    async getBeacons() {
        const [rows] = await pool.query(
            `SELECT b.id, b.mac_address, b.label, b.is_active, b.battery_pct,
                    b.last_seen_at, b.last_rssi, b.ibeacon_major, b.ibeacon_minor,
                    TIMESTAMPDIFF(SECOND, b.last_seen_at, NOW()) AS secs_since_seen,
                    r.room_number AS last_room,
                    u.public_id   AS instructor_id,
                    CONCAT(u.first_name, ' ', u.last_name) AS instructor_name,
                    fp.is_present,
                    present_room.room_number AS present_room
               FROM ble_beacons b
               LEFT JOIN rooms r ON r.id = b.last_room_id
               LEFT JOIN users u ON u.id = b.instructor_id
               LEFT JOIN faculty_presence fp ON fp.instructor_id = b.instructor_id
               LEFT JOIN rooms present_room ON present_room.id = fp.room_id
              ORDER BY b.instructor_id IS NULL DESC, b.last_seen_at DESC`
        );
        return rows;
    },

    /** Assign a tag to an instructor, or pass null to unassign it. */
    async assignBeacon(beaconId, instructorPublicId, label) {
        let instructorId = null;
        if (instructorPublicId) {
            const [[user]] = await pool.execute(
                "SELECT id FROM users WHERE public_id = ? AND role = 'Instructor'",
                [instructorPublicId]
            );
            if (!user) return { ok: false, error: 'That instructor could not be found.' };
            instructorId = user.id;
        }

        try {
            const [result] = await pool.execute(
                'UPDATE ble_beacons SET instructor_id = ?, label = ? WHERE id = ?',
                [instructorId, label || null, beaconId]
            );
            return { ok: result.affectedRows > 0, error: result.affectedRows ? null : 'Tag not found.' };
        } catch (err) {
            // uq_beacon_instructor — one tag per person
            if (err.code === 'ER_DUP_ENTRY') {
                return { ok: false, error: 'That instructor already has a tag assigned.' };
            }
            throw err;
        }
    },

    async setBeaconActive(beaconId, active) {
        const [result] = await pool.execute(
            'UPDATE ble_beacons SET is_active = ? WHERE id = ?', [active ? 1 : 0, beaconId]
        );
        return result.affectedRows > 0;
    },

    async removeBeacon(beaconId) {
        const [result] = await pool.execute('DELETE FROM ble_beacons WHERE id = ?', [beaconId]);
        return result.affectedRows > 0;
    },
};

module.exports = PresenceModel;
