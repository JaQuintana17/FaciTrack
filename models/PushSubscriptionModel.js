const pool = require('../configs/db');

const PushSubscriptionModel = {

    /**
     * Store (or refresh) a browser's push subscription.
     * The endpoint is unique per browser install, so re-subscribing on the same
     * device updates the existing row instead of piling up duplicates.
     */
    async save(publicId, subscription, userAgent) {
        const [[user]] = await pool.execute(
            'SELECT id FROM users WHERE public_id = ?', [publicId]
        );
        if (!user) return { success: false, reason: 'USER_NOT_FOUND' };

        const { endpoint, keys } = subscription || {};
        if (!endpoint || !keys?.p256dh || !keys?.auth) {
            return { success: false, reason: 'INVALID_SUBSCRIPTION' };
        }

        await pool.execute(
            `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                user_id    = VALUES(user_id),
                p256dh     = VALUES(p256dh),
                auth       = VALUES(auth),
                user_agent = VALUES(user_agent)`,
            [user.id, endpoint, keys.p256dh, keys.auth, (userAgent || '').slice(0, 255)]
        );
        return { success: true };
    },

    /** Every device this user has enabled notifications on. */
    async getForUser(internalUserId) {
        const [rows] = await pool.execute(
            'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?',
            [internalUserId]
        );
        return rows.map(r => ({
            id: r.id,
            endpoint: r.endpoint,
            keys: { p256dh: r.p256dh, auth: r.auth },
        }));
    },

    async removeByEndpoint(endpoint) {
        await pool.execute('DELETE FROM push_subscriptions WHERE endpoint = ?', [endpoint]);
    },

    /** Drop a subscription the push service has told us is dead (410/404). */
    async removeById(id) {
        await pool.execute('DELETE FROM push_subscriptions WHERE id = ?', [id]);
    },
};

module.exports = PushSubscriptionModel;
