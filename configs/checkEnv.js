const fs = require('fs');
const path = require('path');

/**
 * Warn when .env defines the same key twice.
 *
 * dotenv lets the last occurrence win silently, so a mistyped key name — a
 * second GOOGLE_CLIENT_SECRET meant to be GOOGLE_CALENDAR_CLIENT_SECRET, say —
 * quietly replaces an unrelated setting further up the file. What surfaces is
 * a failure somewhere else entirely: Google answering the login flow with
 * invalid_client because the id and secret now come from different projects.
 *
 * Values are never printed. The point is only to name the key and the lines.
 */
function checkEnv(envPath = path.join(__dirname, '..', '.env')) {
    let contents;
    try {
        contents = fs.readFileSync(envPath, 'utf8');
    } catch (err) {
        return [];   // no .env is a normal deployment; nothing to check
    }

    const seen = new Map();
    contents.split(/\r?\n/).forEach((line, index) => {
        // Keys only: skip blanks, comments, and anything that isn't KEY=value
        const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
        if (!match) return;

        const key = match[1];
        if (!seen.has(key)) seen.set(key, []);
        seen.get(key).push(index + 1);
    });

    const duplicates = [...seen.entries()].filter(([, lines]) => lines.length > 1);

    for (const [key, lines] of duplicates) {
        console.warn(
            `[Env] ${key} is defined ${lines.length} times in .env (lines ${lines.join(', ')}). ` +
            `Line ${lines[lines.length - 1]} wins — the earlier ones are ignored.`
        );
    }

    return duplicates;
}

module.exports = checkEnv;
