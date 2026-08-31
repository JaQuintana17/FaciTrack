/**
 * Symmetric encryption for values the database must hold but should never
 * leak: a calendar feed URL is a bearer token — anyone holding it can read the
 * whole calendar, so it does not sit in the table as plain text.
 */

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

let cachedKey = null;

/**
 * A stable 32-byte key from configuration. CALENDAR_SECRET is preferred;
 * SESSION_SECRET is accepted so an existing install keeps working, with a
 * warning because rotating the session secret would then orphan stored feeds.
 */
function key() {
    if (cachedKey) return cachedKey;

    const secret = process.env.CALENDAR_SECRET || process.env.SESSION_SECRET;
    if (!secret) {
        throw new Error('Set CALENDAR_SECRET in .env before connecting a calendar.');
    }
    if (!process.env.CALENDAR_SECRET) {
        console.warn('[SecretBox] CALENDAR_SECRET is not set; falling back to SESSION_SECRET. ' +
                     'Changing SESSION_SECRET later will make saved calendar feeds unreadable.');
    }
    cachedKey = crypto.createHash('sha256').update(String(secret)).digest();
    return cachedKey;
}

/** @returns {Buffer} iv | tag | ciphertext */
function seal(plaintext) {
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv(ALGORITHM, key(), iv);
    const body = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

/** Returns null rather than throwing when the key no longer matches. */
function open(sealed) {
    if (!sealed || sealed.length <= IV_BYTES + TAG_BYTES) return null;
    try {
        const buffer = Buffer.isBuffer(sealed) ? sealed : Buffer.from(sealed);
        const decipher = crypto.createDecipheriv(
            ALGORITHM, key(), buffer.subarray(0, IV_BYTES));
        decipher.setAuthTag(buffer.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
        return Buffer.concat([
            decipher.update(buffer.subarray(IV_BYTES + TAG_BYTES)),
            decipher.final(),
        ]).toString('utf8');
    } catch (_) {
        return null;
    }
}

/**
 * A fragment safe to show back to the owner, so they can tell two feeds apart
 * without the page ever rendering the secret itself.
 */
function hint(url) {
    try {
        const parsed = new URL(String(url));
        const tail = parsed.pathname.split('/').filter(Boolean).pop() || '';
        return `${parsed.hostname}/…${tail.slice(-8)}`.slice(0, 80);
    } catch (_) {
        return String(url).slice(0, 24) + '…';
    }
}

module.exports = { seal, open, hint };
