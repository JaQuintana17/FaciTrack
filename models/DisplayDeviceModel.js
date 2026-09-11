const crypto = require('crypto');
const pool = require('../configs/db');

/**
 * Screens authorised to show a Faculty Lounge board.
 *
 * A panel identifies itself with a secret in a cookie. Only the sha256 of that
 * secret is stored, so reading this table gives nobody a working display —
 * same reasoning as a password hash.
 */

// No O/0 or I/1: this code gets read off a screen and repeated down a phone.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

// A code left on an unattended screen should not still work tomorrow.
const CODE_TTL_MINUTES = 30;

function hashToken(secret) {
    return crypto.createHash('sha256').update(String(secret)).digest('hex');
}

function newSecret() {
    return crypto.randomBytes(32).toString('base64url');
}

function newCode() {
    const bytes = crypto.randomBytes(CODE_LENGTH);
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i++) {
        code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    }
    return code;
}

const DisplayDeviceModel = {

    hashToken,
    newSecret,

    /**
     * Register a screen that has just been switched on.
     *
     * Returns the secret exactly once, for the caller to put in the cookie.
     * It is never recoverable afterwards.
     */
    async register(userAgent) {
        // A collision here is vanishingly unlikely but would hand one screen
        // another's identity, so retry rather than assume.
        for (let attempt = 0; attempt < 5; attempt++) {
            const secret = newSecret();
            const code = newCode();
            try {
                const [result] = await pool.execute(
                    `INSERT INTO display_devices
                         (device_token, pairing_code, code_expires_at, user_agent, last_seen_at)
                     VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE), ?, NOW())`,
                    [hashToken(secret), code, CODE_TTL_MINUTES, (userAgent || '').slice(0, 255) || null]
                );
                return { id: result.insertId, secret, pairingCode: code };
            } catch (err) {
                if (err.code !== 'ER_DUP_ENTRY') throw err;
            }
        }
        throw new Error('Could not allocate a pairing code.');
    },

    /** The device behind a cookie secret, or null. */
    async findBySecret(secret) {
        if (!secret) return null;
        const [[row]] = await pool.execute(
            `SELECT dd.*, d.short_name AS department_short, d.full_name AS department_full
               FROM display_devices dd
               LEFT JOIN departments d ON dd.department_id = d.id
              WHERE dd.device_token = ?`,
            [hashToken(secret)]
        );
        return row || null;
    },

    /**
     * A pending screen gets a fresh code once its old one lapses.
     *
     * Without this a panel left running over a weekend would still be showing
     * a code that no longer works, and nobody would know until an admin tried
     * to approve it.
     */
    async refreshCodeIfExpired(deviceId) {
        const [[row]] = await pool.execute(
            `SELECT pairing_code, code_expires_at FROM display_devices
              WHERE id = ? AND status = 'pending'`,
            [deviceId]
        );
        if (!row) return null;
        if (row.code_expires_at && new Date(row.code_expires_at) > new Date()) return row.pairing_code;

        for (let attempt = 0; attempt < 5; attempt++) {
            const code = newCode();
            try {
                await pool.execute(
                    `UPDATE display_devices
                        SET pairing_code = ?, code_expires_at = DATE_ADD(NOW(), INTERVAL ? MINUTE)
                      WHERE id = ?`,
                    [code, CODE_TTL_MINUTES, deviceId]
                );
                return code;
            } catch (err) {
                if (err.code !== 'ER_DUP_ENTRY') throw err;
            }
        }
        throw new Error('Could not allocate a pairing code.');
    },

    /** Records that a screen is still switched on and checking in. */
    async touch(deviceId) {
        await pool.execute('UPDATE display_devices SET last_seen_at = NOW() WHERE id = ?', [deviceId]);
    },

    /** Everything an admin needs to decide, newest requests first. */
    async list() {
        const [rows] = await pool.execute(
            `SELECT dd.id, dd.pairing_code, dd.code_expires_at, dd.label, dd.status,
                    dd.department_id, dd.user_agent, dd.last_seen_at,
                    dd.approved_at, dd.created_at,
                    d.short_name AS department_short,
                    d.full_name  AS department_full,
                    CONCAT(u.first_name, ' ', u.last_name) AS approved_by_name
               FROM display_devices dd
               LEFT JOIN departments d ON dd.department_id = d.id
               LEFT JOIN users u       ON dd.approved_by   = u.id
              ORDER BY FIELD(dd.status, 'pending', 'approved', 'revoked'),
                       dd.created_at DESC`
        );
        return rows;
    },

    /**
     * Approve a screen by the code showing on it.
     *
     * Matching on the code rather than a row id is deliberate: it forces the
     * admin to be looking at the screen, or talking to someone who is.
     */
    async approveByCode(code, { departmentId, label, approvedBy }) {
        const [[device]] = await pool.execute(
            `SELECT id, status, code_expires_at FROM display_devices
              WHERE pairing_code = ?`,
            [String(code || '').trim().toUpperCase()]
        );
        if (!device) return { success: false, reason: 'NOT_FOUND' };
        if (device.status === 'approved') return { success: false, reason: 'ALREADY_APPROVED' };
        if (device.code_expires_at && new Date(device.code_expires_at) < new Date()) {
            return { success: false, reason: 'CODE_EXPIRED' };
        }

        const [result] = await pool.execute(
            `UPDATE display_devices
                SET status = 'approved',
                    department_id = ?,
                    label = ?,
                    approved_by = ?,
                    approved_at = NOW(),
                    -- The code has done its job; leaving it live would let it
                    -- be used to adopt this screen a second time.
                    pairing_code = NULL,
                    code_expires_at = NULL
              WHERE id = ?`,
            [departmentId, (label || '').trim().slice(0, 120) || null, approvedBy, device.id]
        );
        return { success: result.affectedRows > 0, id: device.id };
    },

    /** Point an already-approved screen at a different lounge. */
    async reassign(id, departmentId, label) {
        const [result] = await pool.execute(
            `UPDATE display_devices SET department_id = ?, label = COALESCE(?, label)
              WHERE id = ? AND status = 'approved'`,
            [departmentId, (label || '').trim().slice(0, 120) || null, id]
        );
        return result.affectedRows > 0;
    },

    /**
     * Withdraw a screen's access. The row stays: the panel must be approved
     * again rather than silently resuming, and the history of what was
     * authorised is worth keeping.
     */
    async revoke(id) {
        const [result] = await pool.execute(
            `UPDATE display_devices
                SET status = 'revoked', department_id = NULL,
                    pairing_code = NULL, code_expires_at = NULL
              WHERE id = ?`,
            [id]
        );
        return result.affectedRows > 0;
    },

    /** Forget a screen entirely — for one that was replaced or mis-registered. */
    async remove(id) {
        const [result] = await pool.execute('DELETE FROM display_devices WHERE id = ?', [id]);
        return result.affectedRows > 0;
    },

    /**
     * Drop pending rows nobody ever approved.
     *
     * Every refresh of an unpaired panel would otherwise leave a row behind
     * for good.
     */
    async prunePending(olderThanHours = 48) {
        const [result] = await pool.execute(
            `DELETE FROM display_devices
              WHERE status = 'pending'
                AND created_at < DATE_SUB(NOW(), INTERVAL ? HOUR)`,
            [olderThanHours]
        );
        return result.affectedRows;
    },
};

module.exports = DisplayDeviceModel;
module.exports.CODE_TTL_MINUTES = CODE_TTL_MINUTES;
