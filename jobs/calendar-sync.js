const cron = require('node-cron');
const CalendarModel = require('../models/CalendarModel');

/**
 * Automatic calendar refresh.
 *
 * Connections are pulled in small batches rather than all at once: a feed that
 * has not changed answers 304 and costs almost nothing, but a college's worth
 * of first-time syncs arriving together would stall the event loop.
 */

const SYNC_EVERY_MINUTES = Number(process.env.CALENDAR_SYNC_EVERY_MINUTES) || 20;
const BATCH_SIZE = Number(process.env.CALENDAR_SYNC_BATCH) || 10;

async function syncDueConnections() {
    const due = await CalendarModel.getDueConnections(SYNC_EVERY_MINUTES);
    if (!due.length) return { attempted: 0, ok: 0, failed: 0 };

    let ok = 0, failed = 0;
    for (const connection of due.slice(0, BATCH_SIZE)) {
        try {
            // No owner id: the job syncs on the connection's own behalf.
            // Any failure is already recorded against the row for the
            // instructor to see on their settings page.
            const result = await CalendarModel.syncConnection(connection.id);
            if (result.success) ok++; else failed++;
        } catch (err) {
            failed++;
            console.error(`[CalendarSync] ${connection.id} failed:`, err.message);
        }
    }

    // if (ok || failed) {
    //     console.log(`[CalendarSync] ${ok} synced, ${failed} failed, ${due.length} were due.`);
    // }
    return { attempted: Math.min(due.length, BATCH_SIZE), ok, failed };
}

function startCalendarSyncJob() {
    // Every 5 minutes the job looks for connections whose own interval elapsed
    cron.schedule('*/5 * * * *', async () => {
        try {
            await syncDueConnections();
        } catch (err) {
            console.error('[CalendarSync] Sweep failed:', err);
        }
    });
}

module.exports = startCalendarSyncJob;
module.exports.syncDueConnections = syncDueConnections;
module.exports.SYNC_EVERY_MINUTES = SYNC_EVERY_MINUTES;
