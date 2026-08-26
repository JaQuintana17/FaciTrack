const express = require('express');
const router = express.Router();
const AuthController = require('../controllers/AuthController');
const passport = require('passport');

router.get('/', (req, res) => {
    res.render('pages/index', {
        title: 'FaciTrack - Login',
        error: null
    });
});
router.get('/login', AuthController.renderLogin);
router.post('/login', AuthController.login);
router.post('/login/verify-otp', AuthController.verifyOtp);
router.post('/login/resend-otp', AuthController.resendOtp);
router.get('/logout', AuthController.logout);

// Google OAuth routes
router.get('/auth/google', 
    passport.authenticate('google', {
        scope: ['profile', 'email'],
        prompt: 'select_account'
    })
);

// Translate strategy rejection messages into the error codes the login page understands
const OAUTH_ERROR_CODES = {
    'No email returned from Google.': 'no_email',
    'Only CSPC institutional emails are allowed.': 'domain_not_allowed',
    'Faculty account not found. Please contact the administrator.': 'faculty_not_registered',
    'Your account is inactive.': 'account_inactive',
};

router.get('/auth/google/callback', (req, res, next) => {
    passport.authenticate('google', (err, user, info) => {
        if (err) return next(err);

        if (!user) {
            const code = OAUTH_ERROR_CODES[info?.message] || 'authentication_failed';
            return res.redirect(`/login?error=${code}`);
        }

        req.logIn(user, (loginErr) => {
            if (loginErr) return next(loginErr);
            AuthController.handleGoogleCallback(req, res);
        });
    })(req, res, next);
});

module.exports = router;