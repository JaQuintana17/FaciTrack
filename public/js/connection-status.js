/**
 * Connection status bar.
 *
 * Being offline is a state, not an event, so this is a bar that stays for as
 * long as it is true rather than a toast that vanishes while the problem does
 * not. It says which of two situations the reader is in — looking at a saved
 * page, or looking at a live one that has just lost its connection — because
 * the first means the numbers on screen are old and the second does not.
 *
 * navigator.onLine is only trusted when it says *false*, which is reliable:
 * there is no network interface at all. Saying true only means an interface
 * exists, which a campus Wi-Fi with a captive portal happily reports while
 * nothing can actually reach the server. Anything that claims to be back
 * online is confirmed against /ping before the bar is taken down.
 */
(function () {
    'use strict';

    var PROBE_URL = '/ping';
    var RECHECK_MS = 15000;      // while offline, in case the online event never fires
    var RESTORED_MS = 8000;      // how long "back online" stays before fading out

    var state = 'online';        // 'online' | 'offline' | 'restored'
    var servedFromCache = false; // offline before the page even rendered
    var timer = null;
    var hideTimer = null;
    var bar, message, action;

    // ── The bar ──────────────────────────────────────────────────────────
    function build() {
        bar = document.createElement('div');
        bar.className = 'conn-bar';
        bar.setAttribute('role', 'status');
        bar.setAttribute('aria-live', 'polite');
        bar.hidden = true;

        var dot = document.createElement('span');
        dot.className = 'conn-dot';

        message = document.createElement('span');
        message.className = 'conn-msg';

        action = document.createElement('button');
        action.type = 'button';
        action.className = 'conn-action';
        action.hidden = true;
        action.addEventListener('click', function () {
            if (state === 'restored') window.location.reload();
            else check();
        });

        bar.appendChild(dot);
        bar.appendChild(message);
        bar.appendChild(action);
        document.body.appendChild(bar);
    }

    function render() {
        if (!bar) return;

        clearTimeout(hideTimer);
        bar.classList.toggle('offline', state === 'offline');
        bar.classList.toggle('restored', state === 'restored');

        if (state === 'offline') {
            message.textContent = servedFromCache
                ? 'No internet. Showing the last saved version of this page.'
                : 'No internet. Anything you do now will not be saved.';
            action.hidden = false;
            action.textContent = 'Try again';
            bar.hidden = false;
            return;
        }

        if (state === 'restored') {
            message.textContent = 'Back online. This page may be out of date.';
            action.hidden = false;
            action.textContent = 'Refresh';
            bar.hidden = false;
            // Nothing is broken any more, so the bar retires on its own. The
            // reader keeps the choice of whether the stale page matters.
            hideTimer = setTimeout(function () {
                state = 'online';
                render();
            }, RESTORED_MS);
            return;
        }

        bar.hidden = true;
    }

    // ── Reachability ─────────────────────────────────────────────────────
    function probe() {
        return fetch(PROBE_URL, { method: 'GET', cache: 'no-store' })
            .then(function (res) { return res.ok; })
            .catch(function () { return false; });
    }

    function goOffline(fromLoad) {
        if (state === 'offline') return;
        servedFromCache = Boolean(fromLoad);
        state = 'offline';
        render();

        // The online event is unreliable for a PWA coming back from the
        // background, so poll as a safety net rather than relying on it.
        clearInterval(timer);
        timer = setInterval(function () {
            probe().then(function (ok) { if (ok) goOnline(); });
        }, RECHECK_MS);
    }

    function goOnline() {
        clearInterval(timer);
        timer = null;
        // Only worth announcing to someone who saw the bar go up.
        state = state === 'offline' ? 'restored' : 'online';
        render();
    }

    /** Confirm the current state against the server. */
    function check() {
        if (navigator.onLine === false) {
            goOffline(false);
            return Promise.resolve(false);
        }
        return probe().then(function (ok) {
            if (ok) goOnline();
            else goOffline(false);
            return ok;
        });
    }

    // ── Wiring ───────────────────────────────────────────────────────────
    function start() {
        build();

        // A page that loaded with no network came out of the cache, so what is
        // on screen is as old as the last time this device had a connection.
        if (navigator.onLine === false) {
            goOffline(true);
        } else {
            // One 204 to catch the case navigator.onLine gets wrong: connected
            // to a network that cannot actually reach us.
            probe().then(function (ok) { if (!ok) goOffline(true); });
        }

        window.addEventListener('offline', function () { goOffline(false); });
        window.addEventListener('online', function () {
            // The event fires on an interface coming up, which is not the same
            // as the server being reachable — confirm before clearing the bar.
            probe().then(function (ok) { if (ok) goOnline(); });
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }

    // Exposed for tests and for any page that wants to re-check after a failed
    // request of its own.
    window.ConnectionStatus = {
        check: check,
        current: function () { return state; },
    };
}());
