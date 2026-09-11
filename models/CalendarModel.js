const crypto = require('crypto');
const pool = require('../configs/db');
const secretBox = require('../utils/secretBox');
const feed = require('../services/calendar-feed');
const Google = require('../services/google-calendar');
const GoogleAccountModel = require('./GoogleAccountModel');
const { todayKey, addDays } = require('../utils/wallClock');

/**
 * Subscribed calendars and the events pulled from them.
 *
 * Events are upserted on (connection, uid, occurrence) rather than wiped and
 * reinserted. A feed hands back its whole contents on every sync, so the
 * tempting DELETE-then-INSERT would silently discard every "this blocks
 * appointments" answer the instructor gave.
 */

const CalendarModel = {

    // ── Connections ────────────────────────────────────────────────────────

    /**
     * The instructor's Google connection, created when they connect their
     * calendar and reused from then on.
     *
     * It carries no URL — the events are read through the API using the token
     * in google_accounts. The row still exists because this is where the
     * per-calendar preferences live (does an event block bookings, import
     * titles or busy times only) and because external_events hangs off it.
     */
    async ensureGoogleConnection(userInternalId) {
        const [[existing]] = await pool.execute(
            `SELECT id FROM calendar_connections
              WHERE user_id = ? AND provider = 'google' AND feed_url IS NULL
              LIMIT 1`,
            [userInternalId]);
        if (existing) return existing.id;

        const id = crypto.randomUUID();
        await pool.execute(
            `INSERT INTO calendar_connections
                 (id, user_id, provider, display_name, feed_url, feed_hint,
                  auto_sync, blocking_rule, import_titles)
             VALUES (?, ?, 'google', 'Google Calendar', NULL, NULL, 1, 'ask', 1)`,
            [id, userInternalId]);
        return id;
    },

    /** The instructor's Google connection and its preferences, for settings. */
    async getGoogleConnection(userPublicId) {
        const [[row]] = await pool.execute(
            `SELECT c.id, c.blocking_rule, c.import_titles, c.auto_sync,
                    c.last_synced_at, c.last_status, c.last_error, c.event_count
               FROM calendar_connections c
               JOIN users u ON c.user_id = u.id
              WHERE u.public_id = ? AND c.provider = 'google' AND c.feed_url IS NULL
              LIMIT 1`,
            [userPublicId]);
        return row || null;
    },

    /** Disconnecting Google takes its imported events with it (ON DELETE CASCADE). */
    async removeGoogleConnection(userInternalId) {
        const [result] = await pool.execute(
            `DELETE FROM calendar_connections
              WHERE user_id = ? AND provider = 'google' AND feed_url IS NULL`,
            [userInternalId]);
        return result.affectedRows > 0;
    },

    async getConnections(userPublicId) {
        const [rows] = await pool.execute(
            `SELECT c.id, c.provider, c.display_name, c.feed_hint, c.auto_sync,
                    c.blocking_rule, c.import_titles, c.last_synced_at,
                    c.last_status, c.last_error, c.event_count
               FROM calendar_connections c
               JOIN users u ON c.user_id = u.id
              WHERE u.public_id = ?
              ORDER BY c.created_at ASC, c.id ASC`,
            [userPublicId]);
        return rows;
    },

    /** The connection plus its decrypted URL — only for syncing. */
    async getConnectionForSync(connectionId, userPublicId = null) {
        const [[row]] = await pool.execute(
            `SELECT c.*, u.public_id AS owner_public_id
               FROM calendar_connections c
               JOIN users u ON c.user_id = u.id
              WHERE c.id = ? AND (? IS NULL OR u.public_id = ?)`,
            [connectionId, userPublicId, userPublicId]);
        if (!row) return null;
        // An API-backed connection stores no URL; only a subscribed feed does.
        row.apiBacked = row.feed_url === null;
        row.url = row.apiBacked ? null : secretBox.open(row.feed_url);
        return row;
    },

    async updateConnection(connectionId, userPublicId, { displayName, blockingRule, autoSync, importTitles }) {
        const [result] = await pool.execute(
            `UPDATE calendar_connections c
               JOIN users u ON c.user_id = u.id
                SET c.display_name  = COALESCE(?, c.display_name),
                    c.blocking_rule = COALESCE(?, c.blocking_rule),
                    c.auto_sync     = COALESCE(?, c.auto_sync),
                    c.import_titles = COALESCE(?, c.import_titles)
              WHERE c.id = ? AND u.public_id = ?`,
            [displayName ? String(displayName).trim().slice(0, 120) : null,
             ['always', 'never', 'ask'].includes(blockingRule) ? blockingRule : null,
             autoSync === undefined ? null : (autoSync ? 1 : 0),
             importTitles === undefined ? null : (importTitles ? 1 : 0),
             connectionId, userPublicId]);
        return result.affectedRows > 0;
    },

    /** Removing a connection takes its events with it (ON DELETE CASCADE). */
    async removeConnection(connectionId, userPublicId) {
        const [result] = await pool.execute(
            `DELETE c FROM calendar_connections c
               JOIN users u ON c.user_id = u.id
              WHERE c.id = ? AND u.public_id = ?`,
            [connectionId, userPublicId]);
        return result.affectedRows > 0;
    },

    // ── Syncing ────────────────────────────────────────────────────────────

    /**
     * Pull one connection. A feed that has not changed since the last sync
     * answers 304 and costs nothing.
     */
    async syncConnection(connectionId, userPublicId = null) {
        const connection = await this.getConnectionForSync(connectionId, userPublicId);
        if (!connection) return { success: false, reason: 'NOT_FOUND' };

        if (connection.apiBacked) return this.syncGoogleConnection(connection);

        if (!connection.url) {
            await this.recordFailure(connectionId, 'Saved address could not be read. Reconnect this calendar.');
            return { success: false, reason: 'UNREADABLE' };
        }

        let result;
        try {
            result = await feed.fetchFeed(connection.url, {
                etag: connection.etag,
                lastModified: connection.last_modified,
            });
        } catch (err) {
            await this.recordFailure(connectionId, err.message);
            return { success: false, reason: 'FETCH_FAILED', error: err.message };
        }

        if (result.unchanged) {
            await pool.execute(
                `UPDATE calendar_connections
                    SET last_synced_at = NOW(), last_status = 'ok', last_error = NULL
                  WHERE id = ?`, [connectionId]);
            return { success: true, unchanged: true, imported: 0, removed: 0, pending: 0 };
        }

        try {
            const applied = await this.applyFeed(connectionId, connection.user_id, result);
            return { success: true, unchanged: false, ...applied };
        } catch (err) {
            await this.recordFailure(connectionId, 'That calendar could not be read.');
            throw err;
        }
    },

    /**
     * Pull one Google connection through the Calendar API.
     *
     * Reuses applyFeed so the storage rules — upsert on (uid, occurrence),
     * keep a decision the instructor made by hand, prune what vanished — are
     * identical whichever way the events arrived.
     */
    async syncGoogleConnection(connection) {
        const token = await GoogleAccountModel.accessTokenFor(connection.user_id);
        if (!token) {
            await this.recordFailure(connection.id,
                'Google access has expired. Reconnect your calendar in Settings.');
            return { success: false, reason: 'NOT_CONNECTED' };
        }

        const now = new Date();
        let events;
        try {
            events = await Google.listEvents(token, {
                timeMin: new Date(now.getTime() - feed.WINDOW_BACK_DAYS * 86400000),
                timeMax: new Date(now.getTime() + feed.WINDOW_AHEAD_DAYS * 86400000),
            });
        } catch (err) {
            await this.recordFailure(connection.id, err.message);
            return { success: false, reason: 'FETCH_FAILED', error: err.message };
        }

        try {
            const applied = await this.applyFeed(connection.id, connection.user_id, {
                rows: feed.fromGoogleEvents(events),
            });
            return { success: true, unchanged: false, ...applied };
        } catch (err) {
            await this.recordFailure(connection.id, 'Those events could not be read.');
            throw err;
        }
    },

    /**
     * Write a fetched feed into external_events.
     *
     * Rows already present keep their blocking decision when the instructor
     * set one by hand; everything else follows the connection's rule. Rows the
     * feed no longer lists are dropped, but only inside the window that was
     * just re-read, so history outside it is left alone.
     */
    async applyFeed(connectionId, userInternalId, fetched) {
        const [[connection]] = await pool.execute(
            'SELECT blocking_rule, import_titles FROM calendar_connections WHERE id = ?',
            [connectionId]);
        if (!connection) return { imported: 0, removed: 0, pending: 0 };

        // Either an ICS body to parse, or rows the Google reader already built.
        const rows = fetched.rows || feed.parseFeed(fetched.body);
        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();
            const stamp = new Date();

            for (const row of rows) {
                const blocks = defaultBlocking(connection.blocking_rule, row);
                const decision = connection.blocking_rule === 'ask' && !row.transparent && !row.allDay
                    ? 'pending' : 'auto';

                await conn.execute(
                    `INSERT INTO external_events
                         (connection_id, user_id, uid, occurrence, summary, location,
                          event_date, start_slot, end_slot, all_day, transparent,
                          blocks, decision, last_seen_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                     ON DUPLICATE KEY UPDATE
                         summary      = VALUES(summary),
                         location     = VALUES(location),
                         event_date   = VALUES(event_date),
                         start_slot   = VALUES(start_slot),
                         end_slot     = VALUES(end_slot),
                         all_day      = VALUES(all_day),
                         transparent  = VALUES(transparent),
                         last_seen_at = VALUES(last_seen_at),
                         -- A choice the instructor made outlives a re-sync
                         blocks   = IF(decision = 'user', blocks,   VALUES(blocks)),
                         decision = IF(decision = 'user', decision, VALUES(decision))`,
                    [connectionId, userInternalId, row.uid, row.occurrence,
                     connection.import_titles ? row.summary : null,
                     connection.import_titles ? row.location : null,
                     row.date, row.startSlot, row.endSlot,
                     row.allDay ? 1 : 0, row.transparent ? 1 : 0,
                     blocks ? 1 : 0, decision, stamp]
                );
            }

            // Anything in the re-read window the feed stopped listing is gone
            const from = addDays(todayKey(), -feed.WINDOW_BACK_DAYS);
            const to = addDays(todayKey(), feed.WINDOW_AHEAD_DAYS);
            const [removed] = await conn.execute(
                `DELETE FROM external_events
                  WHERE connection_id = ?
                    AND event_date BETWEEN ? AND ?
                    AND last_seen_at < ?`,
                [connectionId, from, to, stamp]);

            const [[counts]] = await conn.execute(
                `SELECT COUNT(*) AS total,
                        SUM(decision = 'pending') AS pending
                   FROM external_events WHERE connection_id = ?`,
                [connectionId]);

            await conn.execute(
                `UPDATE calendar_connections
                    SET etag = ?, last_modified = ?, last_synced_at = NOW(),
                        last_status = 'ok', last_error = NULL, event_count = ?
                  WHERE id = ?`,
                [fetched.etag || null, fetched.lastModified || null, counts.total, connectionId]);

            await conn.commit();
            return {
                imported: rows.length,
                removed: removed.affectedRows,
                pending: Number(counts.pending) || 0,
            };
        } catch (err) {
            await conn.rollback();
            throw err;
        } finally {
            conn.release();
        }
    },

    async recordFailure(connectionId, message) {
        await pool.execute(
            `UPDATE calendar_connections
                SET last_status = 'error', last_error = ?, last_synced_at = NOW()
              WHERE id = ?`,
            [String(message || 'Sync failed.').slice(0, 300), connectionId]);
    },

    /** Connections due for an automatic pull. */
    async getDueConnections(intervalMinutes) {
        const [rows] = await pool.execute(
            `SELECT id, user_id FROM calendar_connections
              WHERE auto_sync = 1
                AND (last_synced_at IS NULL
                     OR last_synced_at < DATE_SUB(NOW(), INTERVAL ? MINUTE))
              ORDER BY last_synced_at IS NOT NULL, last_synced_at ASC`,
            [intervalMinutes]);
        return rows;
    },

    // ── Reads ──────────────────────────────────────────────────────────────

    /** Imported events for the calendar view. */
    async getEvents(userPublicId, startDate, endDate) {
        const [rows] = await pool.execute(
            `SELECT e.id, e.summary, e.location, e.event_date, e.start_slot, e.end_slot,
                    e.all_day, e.blocks, e.decision, e.transparent,
                    c.display_name AS calendar_name, c.provider
               FROM external_events e
               JOIN calendar_connections c ON e.connection_id = c.id
               JOIN users u ON e.user_id = u.id
              WHERE u.public_id = ?
                AND e.event_date BETWEEN ? AND ?
              ORDER BY e.event_date, e.all_day DESC, e.start_slot`,
            [userPublicId, startDate, endDate]);
        return rows;
    },

    /** Events still waiting on a blocking decision. */
    async getPending(userPublicId) {
        const [rows] = await pool.execute(
            `SELECT e.id, e.summary, e.event_date, e.start_slot, e.end_slot, e.all_day,
                    c.display_name AS calendar_name
               FROM external_events e
               JOIN calendar_connections c ON e.connection_id = c.id
               JOIN users u ON e.user_id = u.id
              WHERE u.public_id = ? AND e.decision = 'pending'
                AND e.event_date >= ?
              ORDER BY e.event_date, e.start_slot`,
            [userPublicId, todayKey()]);
        return rows;
    },

    /** Record the instructor's answer, so a re-sync will not overwrite it. */
    async setBlocking(eventIds, userPublicId, blocks) {
        if (!eventIds.length) return 0;
        const [result] = await pool.query(
            `UPDATE external_events e
               JOIN users u ON e.user_id = u.id
                SET e.blocks = ?, e.decision = 'user'
              WHERE u.public_id = ? AND e.id IN (?)`,
            [blocks ? 1 : 0, userPublicId, eventIds]);
        return result.affectedRows;
    },

    /**
     * Busy intervals contributed by external calendars, for the availability
     * service. All-day blocking events cover the whole working day.
     */
    async getBusyIntervals(userInternalId, startDate, endDate) {
        const [rows] = await pool.execute(
            `SELECT event_date, start_slot, end_slot, all_day, summary
               FROM external_events
              WHERE user_id = ? AND blocks = 1
                AND event_date BETWEEN ? AND ?`,
            [userInternalId, startDate, endDate]);

        return rows.map(r => ({
            date: String(r.event_date).slice(0, 10),
            startSlot: r.all_day ? 0 : r.start_slot,
            endSlot: r.all_day ? 48 : r.end_slot,
            label: r.summary || 'a calendar event',
            source: 'calendar',
        }));
    },
};

/** A feed that says an event is "free" is taken at its word. */
function defaultBlocking(rule, row) {
    if (rule === 'never') return false;
    if (row.transparent) return false;
    // All-day entries are usually birthdays and holidays, not commitments
    if (row.allDay) return false;
    if (rule === 'always') return true;
    return false;   // 'ask' — stays free until the instructor says otherwise
}

module.exports = CalendarModel;
