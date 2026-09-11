const pool = require('../configs/db');
const Google = require('../services/google-calendar');

/**
 * An instructor's connection to their own Google Calendar.
 *
 * One row per instructor, keyed by the internal user id. Tokens go in
 * encrypted and come out decrypted, so no caller outside this file ever
 * handles ciphertext or has to remember to encrypt before writing.
 */
const GoogleAccountModel = {

    /**
     * Upsert, because reconnecting is the normal way to fix a broken
     * connection — it must replace the dead token rather than collide on the
     * primary key. Reconnecting also clears last_error.
     */
    async save(userId, { googleEmail, refreshToken, accessToken, expiresAt, scope }) {
        await pool.execute(
            `INSERT INTO google_accounts
                (user_id, google_email, refresh_token, access_token, expires_at, scope, last_error)
             VALUES (?, ?, ?, ?, ?, ?, NULL)
             ON DUPLICATE KEY UPDATE
                google_email  = VALUES(google_email),
                refresh_token = VALUES(refresh_token),
                access_token  = VALUES(access_token),
                expires_at    = VALUES(expires_at),
                scope         = VALUES(scope),
                last_error    = NULL`,
            [
                userId,
                googleEmail || '',
                Google.encrypt(refreshToken),
                Google.encrypt(accessToken),
                expiresAt || null,
                scope || null,
            ]
        );
    },

    /** Raw row with tokens decrypted, or null when the instructor has not connected. */
    async getByUserId(userId) {
        const [[row]] = await pool.execute(
            `SELECT user_id, google_email, refresh_token, access_token, expires_at,
                    scope, last_error, connected_at
             FROM google_accounts WHERE user_id = ?`,
            [userId]
        );
        if (!row) return null;

        return {
            ...row,
            refresh_token: Google.decrypt(row.refresh_token),
            access_token:  Google.decrypt(row.access_token),
        };
    },

    async getByPublicId(publicId) {
        const [[user]] = await pool.execute('SELECT id FROM users WHERE public_id = ?', [publicId]);
        return user ? this.getByUserId(user.id) : null;
    },

    /**
     * What settings needs to render the card: connected or not, which account,
     * and whether the stored token has since stopped working.
     */
    async statusForPublicId(publicId) {
        const account = await this.getByPublicId(publicId);
        return {
            available: Google.isConfigured(),
            connected: Boolean(account && account.refresh_token && !account.last_error),
            email:     account?.google_email || null,
            error:     account?.last_error || null,
            connectedAt: account?.connected_at || null,
        };
    },

    async remove(userId) {
        await pool.execute('DELETE FROM google_accounts WHERE user_id = ?', [userId]);
    },

    /** Forget a recorded failure, once something has worked again. */
    async clearError(userId) {
        await pool.execute(
            'UPDATE google_accounts SET last_error = NULL WHERE user_id = ? AND last_error IS NOT NULL',
            [userId]
        );
    },

    async markError(userId, message) {
        await pool.execute(
            'UPDATE google_accounts SET last_error = ? WHERE user_id = ?',
            [String(message).slice(0, 255), userId]
        );
    },

    /**
     * A usable access token for this instructor, or null.
     *
     * Returning null rather than throwing is deliberate: every caller's
     * fallback is the static default_meeting_link, and a booking must not fail
     * because Google is briefly unreachable.
     */
    async accessTokenFor(userId) {
        if (!Google.isConfigured()) return null;

        const account = await this.getByUserId(userId);
        if (!account || !account.refresh_token) return null;

        // Still valid — skip the round-trip.
        const expiresAt = account.expires_at ? new Date(account.expires_at).getTime() : 0;
        if (account.access_token && expiresAt - Google.EXPIRY_SKEW_MS > Date.now()) {
            return account.access_token;
        }

        try {
            const fresh = await Google.refreshAccessToken(account.refresh_token);
            await pool.execute(
                'UPDATE google_accounts SET access_token = ?, expires_at = ?, last_error = NULL WHERE user_id = ?',
                [Google.encrypt(fresh.accessToken), fresh.expiresAt, userId]
            );
            return fresh.accessToken;
        } catch (err) {
            // invalid_grant means the instructor revoked access on Google's
            // side. Record it so settings can say "reconnect" instead of
            // silently falling back forever.
            if (err.googleError === 'invalid_grant') {
                await this.markError(userId, 'Access was revoked on Google. Reconnect to keep creating Meet links.');
            } else {
                console.error('[GoogleAccount] Token refresh failed:', err.message);
            }
            return null;
        }
    },
};

module.exports = GoogleAccountModel;
