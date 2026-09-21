const path = require('path');
const fs = require('fs/promises');
const pool = require('../configs/db');

/**
 * Where uploaded files live.
 *
 * One API over two places, because the right answer depends on the host.
 *
 *  - disk: files under storage/uploads/, the way this has always worked.
 *    Right for a server with a disk, and the faster of the two.
 *  - db:   bytes in the stored_files table. Right for a serverless host,
 *    whose filesystem is read-only apart from a scratch directory thrown away
 *    between invocations — there, a written file is gone by the next request.
 *
 * Callers address a file by key ("avatars/<uuid>.jpg"), never by a filesystem
 * path, so nothing above this layer knows or cares which driver is in use.
 */

const STORAGE_ROOT = path.join(__dirname, '..', 'storage', 'uploads');

// Serverless has no durable disk, so default accordingly. FILE_STORE overrides
// it — useful for exercising the database driver locally before deploying.
const DRIVER = process.env.FILE_STORE || (process.env.VERCEL ? 'db' : 'disk');

/**
 * A key is a folder and a filename we generated, and nothing else.
 *
 * Keys reach here from database columns, and one of those columns is filled
 * from a request. Without this, a stored value of "../../.env" would resolve
 * outside the storage root and hand out whatever it found.
 */
const KEY = /^[a-z]+\/[A-Za-z0-9][A-Za-z0-9._-]*$/;

function assertKey(key) {
    if (typeof key !== 'string' || !KEY.test(key) || key.includes('..')) {
        throw new Error(`Refusing to use an unsafe storage key: ${key}`);
    }
    return key;
}

const diskDriver = {
    async put({ key, buffer }) {
        const full = path.join(STORAGE_ROOT, assertKey(key));
        await fs.mkdir(path.dirname(full), { recursive: true });
        await fs.writeFile(full, buffer);
        return key;
    },

    async get(key) {
        const full = path.join(STORAGE_ROOT, assertKey(key));
        try {
            const buffer = await fs.readFile(full);
            return { buffer, mimeType: null, originalName: null, size: buffer.length };
        } catch (err) {
            if (err.code === 'ENOENT') return null;
            throw err;
        }
    },

    async remove(key) {
        // Best effort: a failed delete costs disk space, not correctness.
        await fs.unlink(path.join(STORAGE_ROOT, assertKey(key))).catch(() => {});
    },
};

const dbDriver = {
    async put({ key, buffer, mimeType, originalName, kind }) {
        assertKey(key);
        await pool.execute(
            `INSERT INTO stored_files (file_key, kind, mime_type, original_name, byte_size, data)
             VALUES (?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                 mime_type = VALUES(mime_type),
                 original_name = VALUES(original_name),
                 byte_size = VALUES(byte_size),
                 data = VALUES(data)`,
            [key, kind || key.split('/')[0], mimeType || 'application/octet-stream',
             originalName || null, buffer.length, buffer]
        );
        return key;
    },

    async get(key) {
        assertKey(key);
        const [rows] = await pool.execute(
            'SELECT data, mime_type, original_name, byte_size FROM stored_files WHERE file_key = ?',
            [key]
        );
        if (!rows.length) return null;
        const row = rows[0];
        return {
            buffer: row.data,
            mimeType: row.mime_type,
            originalName: row.original_name,
            size: row.byte_size,
        };
    },

    async remove(key) {
        assertKey(key);
        await pool.execute('DELETE FROM stored_files WHERE file_key = ?', [key]);
    },
};

const driver = DRIVER === 'db' ? dbDriver : diskDriver;

/**
 * Read a file that predates this layer.
 *
 * Rows written before the switch hold an absolute filesystem path rather than
 * a key. On a host that still has those files, returning them is better than
 * showing an instructor that a document they uploaded has vanished. Nothing
 * new is ever written in this shape.
 */
async function getLegacyPath(absolutePath) {
    if (!absolutePath || !path.isAbsolute(absolutePath)) return null;
    // Only ever inside the storage root — the column is data, not a licence to
    // read arbitrary files.
    const resolved = path.resolve(absolutePath);
    if (!resolved.startsWith(path.resolve(STORAGE_ROOT))) return null;
    try {
        const buffer = await fs.readFile(resolved);
        return { buffer, mimeType: null, originalName: path.basename(resolved), size: buffer.length };
    } catch {
        return null;
    }
}

module.exports = {
    driver: DRIVER,
    put: (opts) => driver.put(opts),
    /** Returns null when the file is not there, rather than throwing. */
    get: (key) => driver.get(key),
    remove: (key) => driver.remove(key),
    getLegacyPath,
    STORAGE_ROOT,
};
