const express = require('express');
const router = express.Router();
const AuthController = require('../controllers/AuthController');
const passport = require('passport');

router.get('/', AuthController.renderLanding);
router.get('/login', AuthController.renderLogin);
router.post('/login', AuthController.login);
router.post('/login/verify-otp', AuthController.verifyOtp);
router.post('/login/resend-otp', AuthController.resendOtp);
router.get('/logout', AuthController.logout);

// Google OAuth routes

/**
 * Where Google sends the user back to.
 *
 * Derived from the incoming request rather than pinned to one host, so the
 * same build works on localhost and through a tunnel without editing .env
 * between them — the mismatch that produces redirect_uri_mismatch. Set
 * GOOGLE_CALLBACK_URL to override it for a fixed deployment.
 *
 * Deriving this from the Host header is safe: Google only accepts a
 * redirect_uri that is already registered on the OAuth client, so an
 * unrecognised host is rejected there rather than followed.
 */
function callbackUrlFor(req) {
    if (process.env.GOOGLE_CALLBACK_URL) return process.env.GOOGLE_CALLBACK_URL;
    return `${req.protocol}://${req.get('host')}/auth/google/callback`;
}

router.get('/auth/google', (req, res, next) =>
    passport.authenticate('google', {
        scope: ['profile', 'email'],
        prompt: 'select_account',
        callbackURL: callbackUrlFor(req),
    })(req, res, next)
);

// Translate strategy rejection messages into the error codes the login page understands
const OAUTH_ERROR_CODES = {
    'No email returned from Google.': 'no_email',
    'Only CSPC institutional emails are allowed.': 'domain_not_allowed',
    'Faculty account not found. Please contact the administrator.': 'faculty_not_registered',
    'Your account is inactive.': 'account_inactive',
};

/**
 * Why an exchange failed, in terms the login page can show.
 *
 * Google reports these as OAuth error codes on a TokenError. They are not
 * server faults — a reused code and a misconfigured client are both ordinary
 * outcomes of a sign-in attempt — so they belong on the login page rather than
 * on the 500 page, which is where every one of them used to land.
 */
const TOKEN_ERROR_CODES = {
    invalid_grant:         'oauth_expired',
    redirect_uri_mismatch: 'oauth_misconfigured',
    invalid_client:        'oauth_misconfigured',
    unauthorized_client:   'oauth_misconfigured',
    invalid_request:       'oauth_misconfigured',
    access_denied:         'oauth_cancelled',
};

/** The OAuth code out of whatever shape the error arrived in. */
function oauthErrorCode(err) {
    const raw = err?.code || err?.oauthError?.code || '';
    if (TOKEN_ERROR_CODES[raw]) return TOKEN_ERROR_CODES[raw];

    // passport-oauth2 puts Google's message in .message and the code in .code,
    // but an upstream failure (DNS, proxy, TLS) arrives with neither.
    const text = String(err?.message || '');
    for (const key of Object.keys(TOKEN_ERROR_CODES)) {
        if (text.includes(key)) return TOKEN_ERROR_CODES[key];
    }
    return null;
}

router.get('/auth/google/callback', (req, res, next) => {
    // Declining at the Google prompt comes back as an error and no code. That
    // is somebody changing their mind, not a failure worth a stack trace.
    if (req.query.error) {
        const declined = req.query.error === 'access_denied';
        if (!declined) {
            console.warn('[GoogleOAuth] Google returned error=' + req.query.error +
                (req.query.error_description ? ' (' + req.query.error_description + ')' : ''));
        }
        return res.redirect('/login?error=' + (declined ? 'oauth_cancelled' : 'oauth_misconfigured'));
    }

    // The same value has to be sent again when exchanging the code — Google
    // compares it against the one used to start the flow.
    passport.authenticate('google', { callbackURL: callbackUrlFor(req) }, (err, user, info) => {
        if (err) {
            const code = oauthErrorCode(err);

            // Always log the real reason. The page can only say so much, and
            // without this the cause of a failed sign-in was invisible unless
            // somebody happened to be watching the terminal.
            console.error('[GoogleOAuth] Token exchange failed:',
                err.code || err.name || 'unknown', '-', err.message,
                '| redirect_uri sent:', callbackUrlFor(req));

            // Anything not recognisable as an OAuth outcome really is a fault,
            // and still goes to the error handler where it can be traced.
            if (!code) return next(err);
            return res.redirect(`/login?error=${code}`);
        }

        if (!user) {
            const code = OAUTH_ERROR_CODES[info?.message] || 'authentication_failed';
            return res.redirect(`/login?error=${code}`);
        }

        req.logIn(user, (loginErr) => {
            if (loginErr) return next(loginErr);
            // handleGoogleCallback is async and nothing here awaits it, so a
            // rejection would have gone nowhere and left the request hanging.
            Promise.resolve(AuthController.handleGoogleCallback(req, res)).catch(next);
        });
    })(req, res, next);
});

module.exports = router;