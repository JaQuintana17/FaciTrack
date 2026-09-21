/**
 * Vercel's entry point.
 *
 * Vercel serves a function per file under api/, and hands it the raw request.
 * app.js exports the configured Express app without listening on a port when
 * it detects a serverless host, so the same file still runs `npm start`
 * locally and is imported here in production.
 *
 * vercel.json rewrites every path to this one function, which keeps Express's
 * own router in charge of routing — splitting routes into separate functions
 * would give each its own cold start and its own database pool.
 */
module.exports = require('../app');
