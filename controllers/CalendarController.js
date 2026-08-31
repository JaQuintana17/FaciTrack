const CalendarModel = require('../models/CalendarModel');
const UserModel = require('../models/UserModel');
const AuditLogModel = require('../models/AuditLogModel');
const { FeedError } = require('../services/calendar-feed');
const { todayKey, addDays } = require('../utils/wallClock');

/**
 * External calendar subscriptions.
 *
 * Everything here is scoped to the signed-in instructor: a connection is only
 * ever reachable by its owner, and the feed URL never travels back to the
 * browser — only the masked hint the model stores alongside it.
 */

const CalendarController = {

    async listConnections(req, res) {
        try {
            res.json({ success: true, connections: await CalendarModel.getConnections(req.session.userId) });
        } catch (err) {
            console.error('[CalendarController.listConnections]', err);
            res.status(500).json({ success: false, error: 'Could not load your calendars.' });
        }
    },

    async addConnection(req, res) {
        try {
            const result = await CalendarModel.addConnection(req.session.userId, {
                url: req.body.url,
                displayName: req.body.displayName,
                blockingRule: req.body.blockingRule,
                autoSync: req.body.autoSync !== false && req.body.autoSync !== 'false',
                importTitles: req.body.importTitles !== false && req.body.importTitles !== 'false',
            });

            if (!result.success) {
                return res.status(400).json({ success: false, error: 'That calendar could not be added.' });
            }

            await log(req, 'Connected an external calendar');
            res.json({
                success: true,
                id: result.id,
                imported: result.imported,
                pending: result.pending,
                connections: await CalendarModel.getConnections(req.session.userId),
            });
        } catch (err) {
            // A bad address is the instructor's to fix, not a server fault
            if (err instanceof FeedError) {
                return res.status(422).json({ success: false, error: err.message });
            }
            console.error('[CalendarController.addConnection]', err);
            res.status(500).json({ success: false, error: 'Could not add that calendar.' });
        }
    },

    async updateConnection(req, res) {
        try {
            const ok = await CalendarModel.updateConnection(req.params.id, req.session.userId, {
                displayName: req.body.displayName,
                blockingRule: req.body.blockingRule,
                autoSync: req.body.autoSync === undefined ? undefined : Boolean(req.body.autoSync),
                importTitles: req.body.importTitles === undefined ? undefined : Boolean(req.body.importTitles),
            });
            if (!ok) return res.status(404).json({ success: false, error: 'That calendar is not connected.' });

            res.json({ success: true, connections: await CalendarModel.getConnections(req.session.userId) });
        } catch (err) {
            console.error('[CalendarController.updateConnection]', err);
            res.status(500).json({ success: false, error: 'Could not save that change.' });
        }
    },

    async removeConnection(req, res) {
        try {
            const ok = await CalendarModel.removeConnection(req.params.id, req.session.userId);
            if (!ok) return res.status(404).json({ success: false, error: 'That calendar is not connected.' });

            await log(req, 'Disconnected an external calendar');
            res.json({ success: true, connections: await CalendarModel.getConnections(req.session.userId) });
        } catch (err) {
            console.error('[CalendarController.removeConnection]', err);
            res.status(500).json({ success: false, error: 'Could not remove that calendar.' });
        }
    },

    /** Pull one connection, or every connection this instructor owns. */
    async sync(req, res) {
        try {
            const targets = req.params.id
                ? [{ id: req.params.id }]
                : await CalendarModel.getConnections(req.session.userId);

            if (!targets.length) {
                return res.json({ success: true, synced: 0, imported: 0, pending: 0, failures: [] });
            }

            let imported = 0, synced = 0;
            const failures = [];

            for (const target of targets) {
                const result = await CalendarModel.syncConnection(target.id, req.session.userId);
                if (result.success) {
                    synced++;
                    imported += result.imported || 0;
                } else {
                    failures.push({
                        id: target.id,
                        name: target.display_name || 'That calendar',
                        error: result.error || 'Could not be reached.',
                    });
                }
            }

            const pending = await CalendarModel.getPending(req.session.userId);
            res.json({
                success: true, synced, imported, failures,
                pending: pending.length,
                connections: await CalendarModel.getConnections(req.session.userId),
            });
        } catch (err) {
            console.error('[CalendarController.sync]', err);
            res.status(500).json({ success: false, error: 'Sync failed.' });
        }
    },

    /** Imported events for the calendar grid. */
    async listEvents(req, res) {
        try {
            const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '')
                ? req.query.from : addDays(todayKey(), -31);
            const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '')
                ? req.query.to : addDays(todayKey(), 120);

            res.json({
                success: true,
                events: await CalendarModel.getEvents(req.session.userId, from, to),
            });
        } catch (err) {
            console.error('[CalendarController.listEvents]', err);
            res.status(500).json({ success: false, error: 'Could not load calendar events.' });
        }
    },

    async listPending(req, res) {
        try {
            res.json({ success: true, events: await CalendarModel.getPending(req.session.userId) });
        } catch (err) {
            console.error('[CalendarController.listPending]', err);
            res.status(500).json({ success: false, error: 'Could not load those events.' });
        }
    },

    /** Answer the "does this block appointments?" prompt. */
    async decide(req, res) {
        try {
            const raw = Array.isArray(req.body.eventIds) ? req.body.eventIds : [req.body.eventIds];
            const ids = raw.map(n => parseInt(n, 10)).filter(Number.isFinite);
            if (!ids.length) {
                return res.status(422).json({ success: false, error: 'Nothing to decide.' });
            }
            if (typeof req.body.blocks !== 'boolean') {
                return res.status(422).json({ success: false, error: 'Say whether these block appointments.' });
            }

            const changed = await CalendarModel.setBlocking(ids, req.session.userId, req.body.blocks);
            const pending = await CalendarModel.getPending(req.session.userId);
            res.json({ success: true, changed, pending: pending.length });
        } catch (err) {
            console.error('[CalendarController.decide]', err);
            res.status(500).json({ success: false, error: 'Could not save that.' });
        }
    },
};

async function log(req, action) {
    try {
        const me = await UserModel.getUserByPublicId(req.session.userId);
        await AuditLogModel.log(me.internal_id, me.role, action, 'calendar');
    } catch (err) {
        console.error('[AuditLog] Failed to log calendar change:', err);
    }
}

module.exports = CalendarController;
