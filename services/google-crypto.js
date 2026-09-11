/**
 * At-rest encryption for Google refresh tokens.
 *
 * A refresh token is not a session — it is standing permission to read and
 * write a real person's calendar, and it stays valid until they revoke it. It
 * is the one credential in this database worth more than the row it sits in,
 * so it does not go in as plaintext.
 *
 * AES-256-GCM: the tag detects tampering, so a token that has been altered in
 * the database fails to decrypt instead of being sent to Google.
 */
const crypto = require('crypto');

const ALGO = 'aes-256-gcm';

/**
 * Derived from GOOGLE_TOKEN_KEY, or SESSION_SECRET when that is not set.
 *
 * Falling back matters for a deployment that never adds the new variable:
 * without it every instructor would have to reconnect. The trade-off is that
 * rotating SESSION_SECRET then invalidates stored tokens — which surfaces as
 * "reconnect your Google account", not as a crash.
 */
function key() {
    const secret = process.env.GOOGLE_TOKEN_KEY || process.env.SESSION_SECRET;
    if (!secret) throw new Error('GOOGLE_TOKEN_KEY or SESSION_SECRET must be set to store Google tokens.');
    return crypto.createHash('sha256').update(String(secret)).digest();
}

/** Returns `v1.<iv>.<tag>.<ciphertext>`, all base64url. */
function encrypt(plaintext) {
    if (plaintext == null || plaintext === '') return null;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGO, key(), iv);
    const body = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
    return [
        'v1',
        iv.toString('base64url'),
        cipher.getAuthTag().toString('base64url'),
        body.toString('base64url'),
    ].join('.');
}

/**
 * Returns null rather than throwing when the value cannot be read — a token
 * encrypted under an old key should read as "not connected", which the caller
 * already handles, instead of taking down a booking.
 */
function decrypt(stored) {
    if (!stored) return null;
    try {
        const [version, iv, tag, body] = String(stored).split('.');
        if (version !== 'v1' || !iv || !tag || !body) return null;

        const decipher = crypto.createDecipheriv(ALGO, key(), Buffer.from(iv, 'base64url'));
        decipher.setAuthTag(Buffer.from(tag, 'base64url'));
        return Buffer.concat([
            decipher.update(Buffer.from(body, 'base64url')),
            decipher.final(),
        ]).toString('utf8');
    } catch (err) {
        console.error('[GoogleCrypto] Could not decrypt a stored token — the key may have changed.');
        return null;
    }
}

module.exports = { encrypt, decrypt };
