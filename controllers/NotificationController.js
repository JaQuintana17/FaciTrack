
const NotificationModel = require('../models/NotificationModel');
const UserModel = require('../models/UserModel');
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
};

module.exports = NotificationController;