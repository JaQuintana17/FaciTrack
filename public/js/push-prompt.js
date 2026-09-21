/**
 * The soft ask for notification permission.
 *
 * Notification.requestPermission() can only ever be answered once. A denial is
 * permanent, cannot be re-prompted from script, and costs that person the
 * channel for good — so this asks in our own words first and only reaches for
 * the browser's prompt after somebody has said yes. The browser prompt then
 * fires from inside their click, which is also what browsers require.
 *
 * Every reason not to ask is checked before anything is shown; see shouldAsk().
 * The decision is remembered per device, because a push subscription belongs to
 * a device rather than an account.
 */
(function () {
    'use strict';

    var STORE_KEY = 'facitrack.push.prompt';

    // Long enough that "not now" means not now rather than not this hour, short
    // enough that somebody who changes their mind is asked again eventually.
    var SNOOZE_DAYS = 14;

    // The page has to settle first. Arriving over the top of a dashboard that is
    // still painting reads as an interruption rather than an offer.
    var DELAY_MS = 6000;

    // Who the automatic ask is for.
    //
    // A dean or an admin works at a desk with the system already open — what
    // they would be notified about is on the screen in front of them — so
    // asking for a device permission buys them nothing and interrupts anyway.
    // Students and instructors are the ones who need telling while they are
    // somewhere else, and they are the only ones asked.
    var ASK_ROLES = ['Student', 'Instructor'];

    var overlay = document.getElementById('pushPrompt');
    if (!overlay) return;

    /** Every signed-in page lives under its role's path, so the URL says which. */
    function currentRole() {
        var match = location.pathname.match(/^\/(student|instructor|dean|admin)\b/);
        return match ? match[1].charAt(0).toUpperCase() + match[1].slice(1) : null;
    }

    /* ── Remembering the answer ─────────────────────────────────────────── */

    function read() {
        try {
            return JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {};
        } catch (err) {
            // Private windows and blocked site data both throw here. Failing to
            // read is not a reason to nag, so treat it as "asked recently".
            return { unreadable: true };
        }
    }

    function write(patch) {
        try {
            var next = read();
            for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) next[k] = patch[k];
            localStorage.setItem(STORE_KEY, JSON.stringify(next));
        } catch (err) { /* nothing to do; the worst case is asking again */ }
    }

    /* ── Whether to ask at all ──────────────────────────────────────────── */

    async function shouldAsk() {
        // Cheapest check first: no storage read, no permission query, and no
        // request for a key somebody is never going to be offered.
        if (ASK_ROLES.indexOf(currentRole()) === -1) return false;

        var state = read();
        if (state.unreadable) return false;

        // Already decided, either way. Once the browser has been asked there is
        // nothing left for this modal to do.
        if (state.answered) return false;

        if (state.snoozedAt && Date.now() - state.snoozedAt < SNOOZE_DAYS * 864e5) return false;

        if (!window.FaciTrackPush || !window.FaciTrackPush.isSupported()) return false;

        // 'denied' cannot be undone from here, and 'on' means they already have
        // it. Only somebody who has never been asked is worth asking.
        var pushState = await window.FaciTrackPush.getState();
        if (pushState !== 'off') return false;
        if (Notification.permission !== 'default') return false;

        // Last, because it costs a request: an install with no VAPID keys cannot
        // deliver a notification, so offering one would be a promise we cannot keep.
        try {
            var res = await fetch('/notifications/push/public-key');
            var data = await res.json();
            if (!data || !data.publicKey) return false;
        } catch (err) {
            return false;
        }

        return true;
    }

    /* ── Showing it ─────────────────────────────────────────────────────── */

    var lastFocused = null;

    function tailorToRole() {
        // The reasons differ by role, and a list that includes somebody else's
        // reasons reads as boilerplate.
        var role = currentRole();
        overlay.querySelectorAll('[data-pp-role]').forEach(function (li) {
            var want = li.getAttribute('data-pp-role');
            if (want === 'any') return;
            if (!role) return;               // no role published: leave them all
            li.hidden = want !== role;
        });
    }

    function show() {
        tailorToRole();
        lastFocused = document.activeElement;
        overlay.hidden = false;
        var enable = document.getElementById('ppEnable');
        if (enable) enable.focus();
    }

    function close() {
        overlay.hidden = true;
        if (lastFocused && lastFocused.focus) lastFocused.focus();
    }

    /* ── The answers ────────────────────────────────────────────────────── */

    function later() {
        write({ snoozedAt: Date.now() });
        close();
    }

    async function enable() {
        var btn = document.getElementById('ppEnable');
        var err = document.getElementById('ppError');
        btn.disabled = true;
        btn.textContent = 'Waiting for your browser…';

        // Whatever happens next, the browser has now been asked and will not ask
        // again. Recorded before the await so a reload mid-prompt cannot make
        // this modal reappear over the browser's own dialog.
        write({ answered: true, answeredAt: Date.now() });

        var result;
        try {
            result = await window.FaciTrackPush.enable();
        } catch (e) {
            result = { ok: false, error: 'Something went wrong turning notifications on.' };
        }

        if (result.ok) {
            // Confirmed in place. Closing silently would leave somebody who
            // just granted a permission with no sign it worked.
            document.getElementById('ppTitle').textContent = 'Notifications are on';
            document.getElementById('ppBody').innerHTML =
                '<p class="pp-lede">This device will be notified. You can turn it off any time in Settings.</p>';
            document.querySelector('.pp-actions').hidden = true;
            setTimeout(close, 1800);
            return;
        }

        // Left open rather than closed: a refusal needs an explanation, and
        // "try again" is not available once the browser has said no.
        err.textContent = result.error || 'Notifications could not be turned on.';
        err.hidden = false;
        btn.disabled = false;
        btn.textContent = 'Enable';
        document.getElementById('ppLater').textContent = 'Close';
    }

    /* ── Wiring ─────────────────────────────────────────────────────────── */

    document.getElementById('ppLater').addEventListener('click', later);
    document.getElementById('ppEnable').addEventListener('click', enable);

    // Escape counts as "not now" — the same as the button, so dismissing it
    // does not mean being asked again on the next page.
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && !overlay.hidden) later();
    });

    // Clicking the backdrop closes too, but the card itself must not.
    overlay.addEventListener('click', function (e) {
        if (e.target === overlay) later();
    });

    setTimeout(function () {
        shouldAsk().then(function (ask) { if (ask) show(); });
    }, DELAY_MS);

    // Not role-gated: only the automatic ask is limited. Somebody who goes
    // looking for this — a dean turning notifications on from Settings — has
    // asked for it, which is a different thing from being interrupted by it.
    window.FaciTrackPushPrompt = {
        show: show,
        reset: function () {
            try { localStorage.removeItem(STORE_KEY); } catch (err) { /* nothing to clear */ }
        },
    };
}());
