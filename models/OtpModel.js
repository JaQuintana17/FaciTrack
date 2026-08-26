const crypto = require('crypto');
const bcrypt = require('bcrypt');
const pool = require('../configs/db');

const CODE_LENGTH = 6;
const TTL_MINUTES = 5;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_SECONDS = 60;

/** Cryptographically secure 6-digit code, zero-padded. */
function generateCode() {
    return String(crypto.randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, '0');
}

const OtpModel = {

    /**
     * Issue a new code for a user, invalidating any still-pending one.
     * Returns the plaintext code — the caller emails it and must not store it.
     */
    async issue(userId) {
        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();

            // Only one code may be live at a time
            await conn.execute(
                `UPDATE otp_codes SET consumed_at = NOW()
                 WHERE user_id = ? AND consumed_at IS NULL`,
                [userId]
            );

            const code = generateCode();
            const codeHash = await bcrypt.hash(code, 10);

            await conn.execute(
                `INSERT INTO otp_codes (user_id, code_hash, expires_at)
                 VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE))`,
                [userId, codeHash, TTL_MINUTES]
            );

            await conn.commit();
            return { code, expiresInMinutes: TTL_MINUTES };
        } catch (err) {
            await conn.rollback();
            throw err;
        } finally {
            conn.release();
        }
    },

    /**
     * Check a submitted code against the user's live OTP.
     * Returns { success } or { success: false, reason }.
     */
    async verify(userId, submittedCode) {
        const [[record]] = await pool.execute(
            `SELECT id, code_hash, attempts, expires_at < NOW() AS is_expired
             FROM otp_codes
             WHERE user_id = ? AND consumed_at IS NULL
             ORDER BY id DESC LIMIT 1`,
            [userId]
        );

        if (!record) return { success: false, reason: 'NO_CODE' };

        if (record.is_expired) {
            await this.invalidate(record.id);
            return { success: false, reason: 'EXPIRED' };
        }

        if (record.attempts >= MAX_ATTEMPTS) {
            await this.invalidate(record.id);
            return { success: false, reason: 'TOO_MANY_ATTEMPTS' };
        }

        const match = await bcrypt.compare(String(submittedCode), record.code_hash);
        if (!match) {
            await pool.execute(
                'UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?',
                [record.id]
            );
            const remaining = MAX_ATTEMPTS - (record.attempts + 1);
            return { success: false, reason: 'INVALID', attemptsRemaining: remaining };
        }

        // Burn the code so it cannot be replayed
        await this.invalidate(record.id);
        return { success: true };
    },

    async invalidate(otpId) {
        await pool.execute(
            'UPDATE otp_codes SET consumed_at = NOW() WHERE id = ?',
            [otpId]
        );
    },

    /** Guards the resend button against being used as an email flood. */
    async secondsUntilResendAllowed(userId) {
        const [[last]] = await pool.execute(
            `SELECT TIMESTAMPDIFF(SECOND, created_at, NOW()) AS age
             FROM otp_codes WHERE user_id = ?
             ORDER BY id DESC LIMIT 1`,
            [userId]
        );
        if (!last) return 0;
        return Math.max(0, RESEND_COOLDOWN_SECONDS - Number(last.age));
    },

    MAX_ATTEMPTS,
    TTL_MINUTES,
};

module.exports = OtpModel;
