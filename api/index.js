/**
 * Vercel's entry point.
 *
 * Vercel serves a function per file under api/, and hands it the raw request.
 * app.js exports the configured Express app without listening on a port when
 * it detects a serverless host, so the same file runs `npm start` locally and
 * is imported here in production.
 *
 * The require is wrapped because a throw *while loading* app.js — a missing or
 * misconfigured env var, a CA file that isn't in the bundle, a native module
 * that won't load — otherwise surfaces only as Vercel's opaque
 * FUNCTION_INVOCATION_FAILED, with the real reason buried in logs the operator
 * has to go and fetch. Catching it lets the browser show what actually failed,
 * which during bring-up is the difference between a fix and a guess.
 */
let app = null;
let startupError = null;

try {
    app = require('../app');
} catch (err) {
    startupError = err;
    console.error('[Startup] FaciTrack failed to load:', err && err.stack ? err.stack : err);
}

module.exports = (req, res) => {
    if (!startupError) return app(req, res);

    // The message from a load-time throw names the misconfiguration (which env
    // var, which missing file) but not any secret value, so it is safe to show.
    // The stack is included only when explicitly asked for.
    const showStack = process.env.STARTUP_DEBUG === '1';
    const code = startupError.code ? startupError.code + ': ' : '';
    const body =
        'FaciTrack could not start.\n\n' +
        code + (startupError.message || 'Unknown startup error') + '\n\n' +
        'This is a startup/configuration error, not a page error — usually a ' +
        'missing or wrong environment variable. Common cause on Vercel: DB_SSL_CA ' +
        'is a file path, but there is no file to read; use DB_SSL_CA_CERT with the ' +
        'certificate pasted inline instead.\n' +
        (showStack && startupError.stack ? '\n' + startupError.stack + '\n' : '');

    res.statusCode = 503;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(body);
};
