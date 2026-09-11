/**
 * Google Calendar / Google Meet.
 *
 * Creates a real scheduled meeting for an online consultation: an event on the
 * instructor's own calendar with the student invited and a Meet link minted
 * for that one appointment.
 *
 * This talks to the REST API with fetch rather than pulling in `googleapis`.
 * Three endpoints are needed — token, events.insert, events.delete — and the
 * package is tens of megabytes of generated clients for services this project
 * will never call.
 *
 * Nothing here throws at import time. When the OAuth client is not configured
 * every entry point reports "not available" and callers fall back to the
 * instructor's static default_meeting_link, which is what shipped before.
 */
const crypto = require('crypto');
const { encrypt, decrypt } = require('./google-crypto');

const AUTH_URL   = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL  = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

// Consultations are always local. Sending a floating time plus an explicit
// zone means the meeting stays at 1 PM Manila regardless of where the
// instructor's Google account thinks it lives.
const TIME_ZONE = 'Asia/Manila';

/**
 * calendar.events is the narrowest scope that can create an event — there is
 * no "create only" variant. openid/email are what let the callback record
 * which Google account was actually connected, so settings can show it.
 */
const SCOPES = [
    'https://www.googleapis.com/auth/calendar.events',
    'openid',
    'email',
];

// Refresh a little early rather than discovering expiry mid-booking.
const EXPIRY_SKEW_MS = 60 * 1000;

let warnedAboutHalfPair = false;

/**
 * The OAuth client used for calendar access.
 *
 * Its own by preference, falling back to the sign-in client. Keeping them
 * separate matters because calendar.events is a *sensitive* scope: adding it
 * to the client students sign in with changes the consent screen for everyone,
 * and puts the whole app — student login included — under Google's
 * verification requirements. A second client, ideally in its own Cloud
 * project, confines that to the instructors who actually need it.
 *
 * Resolved as a *pair*. Falling back field by field would pair the client id
 * of one Cloud project with the secret of another the moment either half is
 * missing, and Google answers a mismatched pair with a bare invalid_client
 * that names neither the project nor the field at fault.
 */
function credentials() {
    const id = process.env.GOOGLE_CALENDAR_CLIENT_ID;
    const secret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
    if (id && secret) return { id, secret };

    if ((id || secret) && !warnedAboutHalfPair) {
        warnedAboutHalfPair = true;
        console.warn('[GoogleCalendar] GOOGLE_CALENDAR_CLIENT_ID and GOOGLE_CALENDAR_CLIENT_SECRET must be set together. ' +
            `Only ${id ? 'the ID' : 'the secret'} is set, so the sign-in client is being used instead.`);
    }

    return { id: process.env.GOOGLE_CLIENT_ID, secret: process.env.GOOGLE_CLIENT_SECRET };
}

function clientId() { return credentials().id; }
function clientSecret() { return credentials().secret; }

function isConfigured() {
    return Boolean(clientId() && clientSecret());
}

/**
 * Must match a redirect URI registered on the OAuth client exactly.
 *
 * Derived from the request for the same reason as the login callback: the app
 * is reached on localhost and through a tunnel, and pinning one host in .env
 * is what produces redirect_uri_mismatch after switching between them.
 */
function redirectUri(req) {
    if (process.env.GOOGLE_CALENDAR_REDIRECT_URI) return process.env.GOOGLE_CALENDAR_REDIRECT_URI;
    return `${req.protocol}://${req.get('host')}/instructor/google/callback`;
}

/**
 * access_type=offline plus prompt=consent is what actually returns a refresh
 * token. Google only issues one on the first consent, so without the forced
 * prompt an instructor who reconnects gets an access token that dies in an
 * hour and no way to renew it.
 */
function consentUrl(req, state) {
    const params = new URLSearchParams({
        client_id:     clientId(),
        redirect_uri:  redirectUri(req),
        response_type: 'code',
        scope:         SCOPES.join(' '),
        access_type:   'offline',
        prompt:        'consent',
        include_granted_scopes: 'true',
        state,
    });
    return `${AUTH_URL}?${params.toString()}`;
}

/** Reads the email out of an id_token without verifying it. */
function emailFromIdToken(idToken) {
    // Safe unverified: this token came straight back from Google's own token
    // endpoint over TLS in response to our client secret. It was not routed
    // through the browser, so there is no third party to have forged it.
    try {
        const payload = String(idToken).split('.')[1];
        return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')).email || null;
    } catch (err) {
        return null;
    }
}

async function postForm(url, body) {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(body).toString(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const err = new Error(data.error_description || data.error || `Google returned ${res.status}`);
        err.googleError = data.error || null;
        throw err;
    }
    return data;
}

/** Exchanges the one-time code from the consent redirect for stored tokens. */
async function exchangeCode(code, uri) {
    const data = await postForm(TOKEN_URL, {
        code,
        client_id:     clientId(),
        client_secret: clientSecret(),
        redirect_uri:  uri,
        grant_type:    'authorization_code',
    });

    if (!data.refresh_token) {
        // Happens when the account has consented before and the prompt was
        // skipped. Nothing usable comes of storing the access token alone.
        throw new Error('Google did not return a refresh token. Remove FaciTrack at myaccount.google.com/permissions and connect again.');
    }

    return {
        refreshToken: data.refresh_token,
        accessToken:  data.access_token || null,
        expiresAt:    data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null,
        scope:        data.scope || null,
        email:        emailFromIdToken(data.id_token),
    };
}

async function refreshAccessToken(refreshToken) {
    const data = await postForm(TOKEN_URL, {
        refresh_token: refreshToken,
        client_id:     clientId(),
        client_secret: clientSecret(),
        grant_type:    'refresh_token',
    });
    return {
        accessToken: data.access_token,
        expiresAt:   data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null,
    };
}

/** Best-effort: a failed revoke should not block disconnecting locally. */
async function revokeToken(refreshToken) {
    try {
        await postForm(REVOKE_URL, { token: refreshToken });
        return true;
    } catch (err) {
        console.warn('[GoogleCalendar] Revoke failed (token may already be dead):', err.message);
        return false;
    }
}

/** YYYY-MM-DD from either a string or the Date mysql2 hands back for a DATE. */
function dateKey(value) {
    if (value instanceof Date) {
        return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
    }
    return String(value).slice(0, 10);
}

/** HH:MM:SS from a TIME column, which may arrive with or without seconds. */
function timeKey(value) {
    const [h = '00', m = '00', s = '00'] = String(value).split(':');
    return `${h.padStart(2, '0')}:${m}:${s}`;
}

/**
 * Creates the calendar event and returns its Meet link.
 *
 * The student goes on as an attendee, not just in the description: on Google
 * Workspace an invited attendee is admitted to the Meet directly, while an
 * uninvited one has to knock and wait for the instructor to notice.
 *
 * Google's own invitation email is suppressed (sendUpdates=none) because
 * FaciTrack already emails both parties about the booking, and two arriving
 * together reads as a duplicate rather than a confirmation.
 */
async function createMeetEvent(accessToken, {
    summary, description, date, startTime, endTime, attendeeEmails = [],
}) {
    const day = dateKey(date);
    const body = {
        summary,
        description,
        start: { dateTime: `${day}T${timeKey(startTime)}`, timeZone: TIME_ZONE },
        end:   { dateTime: `${day}T${timeKey(endTime)}`,   timeZone: TIME_ZONE },
        attendees: attendeeEmails.filter(Boolean).map(email => ({ email })),
        // Our own marker. The calendar sync reads this same calendar back, and
        // without a tag every consultation FaciTrack scheduled would return as
        // an "external event" sitting on top of the appointment it belongs to.
        extendedProperties: { private: { facitrack: 'consultation' } },
        conferenceData: {
            createRequest: {
                // Google's idempotency key: retrying with the same id returns
                // the same conference instead of minting a second one.
                requestId: crypto.randomUUID(),
                conferenceSolutionKey: { type: 'hangoutsMeet' },
            },
        },
    };

    const res = await fetch(`${EVENTS_URL}?conferenceDataVersion=1&sendUpdates=none`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(data.error?.message || `Calendar API returned ${res.status}`);
    }

    const link = data.hangoutLink
        || data.conferenceData?.entryPoints?.find(e => e.entryPointType === 'video')?.uri
        || null;

    if (!link) throw new Error('Calendar created the event but returned no Meet link.');

    return { eventId: data.id, meetingLink: link, htmlLink: data.htmlLink || null };
}

/**
 * Every event on the instructor's primary calendar within a window.
 *
 * singleEvents=true asks Google to expand recurrence server-side, so a weekly
 * class comes back as individual dated occurrences. That is the single largest
 * simplification over reading ICS, where expanding RRULEs correctly — with
 * EXDATEs, overrides and timezone shifts — is the hardest part of the job.
 *
 * The whole window is listed on every sync rather than using a syncToken.
 * Incremental sync returns only what changed, which would fight the prune in
 * CalendarModel.applyFeed: that deletes rows the feed stopped listing, and an
 * unchanged event simply would not be listed. A few hundred events every 20
 * minutes is cheap; correctness here is not.
 */
async function listEvents(accessToken, { timeMin, timeMax, maxPages = 10 } = {}) {
    const events = [];
    let pageToken = null;

    for (let page = 0; page < maxPages; page++) {
        const params = new URLSearchParams({
            timeMin: timeMin.toISOString(),
            timeMax: timeMax.toISOString(),
            singleEvents: 'true',
            orderBy: 'startTime',
            maxResults: '250',
            // Cancelled instances of a recurring event are of no interest;
            // they are absences, not bookings.
            showDeleted: 'false',
        });
        if (pageToken) params.set('pageToken', pageToken);

        const res = await fetch(`${EVENTS_URL}?${params.toString()}`, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data.error?.message || `Calendar API returned ${res.status}`);
        }

        events.push(...(data.items || []));
        pageToken = data.nextPageToken;
        if (!pageToken) break;
    }

    return events;
}

/** 404/410 mean the event is already gone, which is the outcome we wanted. */
async function deleteEvent(accessToken, eventId) {
    const res = await fetch(`${EVENTS_URL}/${encodeURIComponent(eventId)}?sendUpdates=none`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.ok || res.status === 404 || res.status === 410) return true;
    throw new Error(`Calendar API returned ${res.status} deleting the event.`);
}

module.exports = {
    isConfigured,
    redirectUri,
    consentUrl,
    exchangeCode,
    refreshAccessToken,
    revokeToken,
    createMeetEvent,
    listEvents,
    deleteEvent,
    encrypt,
    decrypt,
    SCOPES,
    TIME_ZONE,
    EXPIRY_SKEW_MS,
};
