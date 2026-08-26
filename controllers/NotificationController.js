
const NotificationModel = require('../models/NotificationModel');
const UserModel = require('../models/UserModel');
const PushSubscriptionModel = require('../models/PushSubscriptionModel');
const push = require('../services/push');
const { addClient, removeClient } = require('../realtime/sseRegistry');

const NotificationController = {
    async markAllRead(req, res) {
        try {
            const result = await NotificationModel.markAllRead(req.session.userId);
            res.json(result);
        } catch (error) {
            console.error('Error marking all notifications as read:', error);
            res.status(500).json({ error: 'Failed to mark notifications as read' });
        }
    },

    async markReadById(req, res) {
        try {
            const result = await NotificationModel.markOneRead(req.session.userId, parseInt(req.params.id, 10));
            res.json(result);
        } catch (error) {
            console.error('Error marking notification as read:', error);
            res.status(500).json({ error: 'Failed to mark notification as read' });
        }
    },

    async clearRead(req, res) {
        try {
            const result = await NotificationModel.clearRead(req.session.userId);
            res.json(result);
        } catch (error) {
            console.error('Error marking notification as read:', error);
            res.status(500).json({ error: 'Failed to mark notification as read' });
        }
    },

    async loadMore(req, res) {
        try {
            const offset = parseInt(req.query.offset, 10) || 0;
            const result = await NotificationModel.getMoreRead(req.session.userId, offset);
            res.json(result);
        } catch (error) {
            console.error('Error marking notification as read:', error);
            res.status(500).json({ error: 'Failed to mark notification as read' });
        }
    },

    async stream(req, res) {
        if (!req.session?.userId) return res.status(401).end();

        const user = await UserModel.getUserByPublicId(req.session.userId);
        if (!user) return res.status(401).end();

        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
        });
        res.write('\n');

        addClient(user.internal_id, res);

        const heartbeat = setInterval(() => {
            res.write(': heartbeat\n\n');
        }, 25000);

        req.on('close', () => {
            clearInterval(heartbeat);
            removeClient(user.internal_id, res);
        });
    },

    /** The browser needs this to subscribe; it is public by design. */
    getPushPublicKey(req, res) {
        res.json({ publicKey: push.publicKey });
    },

    async subscribePush(req, res) {
        try {
            const result = await PushSubscriptionModel.save(
                req.session.userId,
                req.body,
                req.headers['user-agent']
            );
            if (!result.success) {
                return res.status(400).json({ success: false, error: 'Invalid subscription.' });
            }
            res.json({ success: true });
        } catch (error) {
            console.error('[Push] Failed to save subscription:', error);
            res.status(500).json({ success: false, error: 'Failed to save subscription.' });
        }
    },

    async unsubscribePush(req, res) {
        try {
            const { endpoint } = req.body || {};
            if (endpoint) await PushSubscriptionModel.removeByEndpoint(endpoint);
            res.json({ success: true });
        } catch (error) {
            console.error('[Push] Failed to remove subscription:', error);
            res.status(500).json({ success: false, error: 'Failed to remove subscription.' });
        }
    },

    /** Fires a test notification to the caller's own devices. */
    async testPush(req, res) {
        try {
            const user = await UserModel.getUserByPublicId(req.session.userId);
            if (!user) return res.status(404).json({ success: false, error: 'User not found.' });

            const result = await push.sendToUser(user.internal_id, {
                title: 'FaciTrack',
                body: 'Device notifications are working.',
                url: user.role === 'Instructor' ? '/instructor/appointments' : '/student/appointments',
                tag: 'facitrack-test',
            });
            res.json({ success: true, ...result });
        } catch (error) {
            console.error('[Push] Test send failed:', error);
            res.status(500).json({ success: false, error: 'Failed to send test notification.' });
        }
    },
};

module.exports = NotificationController;