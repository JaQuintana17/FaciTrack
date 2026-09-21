// Import required modules
require('dotenv').config();
require('./configs/checkEnv')();
const express = require('express');
const session = require('express-session');
const path = require('path');
const { ensureSeedUsers } = require('./services/auth');
const { authContext, requireRole } = require('./middleware/auth');
const attachNotifications = require('./middleware/attachNotifications');
const auditNavigation = require('./middleware/auditNavigation');
const passport = require('./configs/passport');
const startReminderJob = require('./jobs/reminder');
const startCalendarSyncJob = require('./jobs/calendar-sync');
const startPresenceSweepJob = require('./jobs/presence-sweep');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;
ensureSeedUsers(); // remove soon

// Set EJS as templating engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Behind a tunnel or reverse proxy (ngrok in testing, whatever CSPC puts in
// front of this later), the real scheme arrives in X-Forwarded-Proto. Without
// this, req.protocol reports "http" on an https request and anything built
// from it — the OAuth callback especially — comes out wrong.
app.set('trust proxy', 1);

// Middleware: Serve static files from public folder
app.use(express.static(path.join(__dirname, 'public')));

// Middleware: Parse URL-encoded bodies (form data)
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Middleware: Parse JSON bodies
app.use(express.json({ limit: '10mb' }));

// Security: Basic headers
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});

/**
 * Reachability probe for public/js/connection-status.js.
 *
 * Mounted above the session, logging and notification middleware so that
 * polling it costs nothing and writes no log noise. It deliberately does not
 * touch the database: this answers "can the browser reach the server", and
 * folding a database check in here would report the whole app as offline over
 * a problem the user cannot do anything about from a phone.
 */
app.get('/ping', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.status(204).end();
});

// Middleware: Global logging
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false,
        maxAge: 1000 * 60 * 60 * 8
    },
}));
app.use(passport.initialize());
app.use(passport.session());

// Legacy cookie-session context — must run after session() so req.session exists.
// TODO (Phase 1): remove along with the JSON-file auth stack.
app.use(authContext);

// Middleware: notifications
app.use(attachNotifications);
// Middleware: audit navigations
app.use(auditNavigation);

startReminderJob();
startCalendarSyncJob();
// Absence is a timeout, and it has to keep running when every scanner is off —
// which is exactly when somebody would otherwise be left parked in a room.
startPresenceSweepJob();

// Routes 
// app.use('/', require('./routes/index'));
app.use('/', require('./routes/auth'));
app.use('/notifications', require('./routes/notification'));
// Token-authenticated, so it sits above the role guards — calendar clients
// subscribe with no session. See routes/calendar-feed.js.
app.use('/calendar', require('./routes/calendar-feed'));
// Shared-secret authenticated: the BLE room scanners are devices with no
// session, so this also sits above the role guards. See routes/presence.js.
app.use('/api/presence', require('./routes/presence'));
// The Faculty Lounge board: a screen on a wall, so no session either. It
// publishes a name, In or Out, and the availability the instructor set —
// never a room. See routes/display.js.
app.use('/display', require('./routes/display'));
// Profile photos: authenticated, but the same for every role — the sidebar
// avatar is one shared control — so this sits above the per-role mounts.
app.use('/', require('./routes/profile'));
// Who is in. Read by every role's pages, scoped to the viewer's department,
// so one answer serves them all. See routes/presence-view.js.
app.use('/', require('./routes/presence-view'));
app.use('/student', requireRole('Student'), require('./routes/student'));
app.use('/instructor', requireRole('Instructor'), require('./routes/instructor'));
app.use('/export', require('./routes/export'));
app.use('/dean', requireRole('Dean'), require('./routes/dean'));
app.use('/admin', requireRole('Admin'), require('./routes/admin'));
app.use('/superadmin', require('./routes/superadmin'));
// 404: nothing above matched. Answer fetch/XHR callers with JSON, browsers with
// the page — using the error handler's test so the two agree on who is asking.
app.use((req, res) => {
    if (require('./middleware/errorHandler').wantsHtml(req)) {
        return res.status(404).render('pages/404', {
            title: 'FaciTrack - Page Not Found',
            role: req.session?.role || null,
            requestedPath: req.originalUrl,
        });
    }
    res.status(404).json({ status: 'error', message: 'Not found' });
});

// Error handling middleware. Renders a page for browsers and JSON for fetch
// callers, and tells "the database is unreachable" apart from "this broke".
// See middleware/errorHandler.js.
app.use(require('./middleware/errorHandler')());

// Start server
app.listen(PORT, () => {
    console.log(`🚀 FaciTrack server running on http://localhost:${PORT}`);
});
