/**
 * Loading feedback, applied once for the whole app.
 *
 * Three things happen without any per-button wiring:
 *   1. A thin bar at the top of the page shows while a page is navigating or a
 *      request is in flight, so a slow round-trip does not look like a freeze.
 *   2. The button that triggered a request spins until that request settles.
 *      A click is matched to the fetch it fires in the same tick, so a button
 *      that only toggles some UI never spins.
 *   3. A form that actually navigates spins its submit button until the page
 *      turns over.
 *
 * It wraps window.fetch, so every existing fetch call is covered as-is. Polling
 * and heartbeats are excluded — otherwise the bar would flicker every few
 * seconds — and the button spinner never touches `disabled`, so handlers that
 * manage their own disabled state are left alone.
 */
(function () {
    'use strict';
    if (window.__loadingInit) return;
    window.__loadingInit = true;

    // ── styles, injected so the file is self-contained wherever it loads ──
    var style = document.createElement('style');
    style.textContent = [
        '#app-progress{position:fixed;top:0;left:0;height:3px;width:0;',
        'background:var(--primary-blue,#0A3D62);box-shadow:0 0 8px rgba(10,61,98,.5);',
        'z-index:4000;opacity:0;pointer-events:none;transition:width .2s ease,opacity .3s ease}',
        '#app-progress.active{opacity:1}',
        /* The button keeps its size; its label goes invisible and a spinner
           takes the middle. --btn-spin is the label colour, captured before it
           is hidden, so the spinner contrasts with the button on its own. */
        '.btn-loading{position:relative!important;color:transparent!important;',
        'pointer-events:none!important;cursor:default!important}',
        '.btn-loading>*{visibility:hidden}',
        '.btn-loading::after{content:"";position:absolute;top:50%;left:50%;',
        'width:1.05em;height:1.05em;margin:-.525em 0 0 -.525em;border:2px solid transparent;',
        'border-top-color:var(--btn-spin,currentColor);border-right-color:var(--btn-spin,currentColor);',
        'border-radius:50%;animation:app-btn-spin .6s linear infinite}',
        '@keyframes app-btn-spin{to{transform:rotate(360deg)}}'
    ].join('');
    (document.head || document.documentElement).appendChild(style);

    // ── the top progress bar, ref-counted for concurrent requests ──
    var bar = null, active = 0, showTimer = null;

    function ensureBar() {
        if (bar) return bar;
        bar = document.createElement('div');
        bar.id = 'app-progress';
        (document.body || document.documentElement).appendChild(bar);
        return bar;
    }

    function barStart() {
        active++;
        if (active > 1) return;
        // A short delay so a fast request never flashes the bar.
        showTimer = setTimeout(function () {
            var b = ensureBar();
            b.classList.add('active');
            var w = 12;
            b.style.width = w + '%';
            b._creep = setInterval(function () {
                w = Math.min(90, w + (90 - w) * 0.1);
                b.style.width = w + '%';
            }, 300);
        }, 150);
    }

    function barDone() {
        active = Math.max(0, active - 1);
        if (active > 0) return;
        clearTimeout(showTimer);
        if (!bar) return;
        clearInterval(bar._creep);
        bar.style.width = '100%';
        setTimeout(function () {
            if (active === 0) { bar.classList.remove('active'); bar.style.width = '0'; }
        }, 300);
    }

    // ── button spinner (visual only; never sets disabled) ──
    function startBtn(btn) {
        if (!btn || btn.classList.contains('btn-loading')) return;
        try { btn.style.setProperty('--btn-spin', getComputedStyle(btn).color); } catch (e) { /* ok */ }
        btn.classList.add('btn-loading');
        btn.setAttribute('aria-busy', 'true');
    }
    function stopBtn(btn) {
        if (!btn) return;
        btn.classList.remove('btn-loading');
        btn.removeAttribute('aria-busy');
    }

    // ── remember the button that was just clicked, for one tick ──
    var pendingBtn = null;
    document.addEventListener('click', function (e) {
        var btn = e.target.closest('button, .btn, [role="button"], input[type="submit"], input[type="button"]');
        if (!btn || btn.disabled || btn.classList.contains('btn-loading')) { pendingBtn = null; return; }
        pendingBtn = btn;
        // Only a fetch fired synchronously in this handler counts as "this
        // button's request"; anything later is unrelated.
        setTimeout(function () { if (pendingBtn === btn) pendingBtn = null; }, 0);
    }, true);

    // ── requests that should not show the indicator (polling, heartbeats) ──
    var SILENT = /\/ping(\b|\?)|\/notifications\/(poll|stream)|\/tasks\//;
    function isSilent(input) {
        try {
            var url = typeof input === 'string' ? input : (input && input.url) || '';
            return SILENT.test(url);
        } catch (e) { return false; }
    }

    // ── wrap fetch so every request drives the bar and its button ──
    if (window.fetch && !window.fetch.__loadingWrapped) {
        var orig = window.fetch;
        var wrapped = function (input, init) {
            if (isSilent(input)) return orig.call(this, input, init);
            var btn = pendingBtn; pendingBtn = null;
            if (btn) startBtn(btn);
            barStart();
            var finished = false;
            var finish = function () {
                if (finished) return;
                finished = true;
                if (btn) stopBtn(btn);
                barDone();
            };
            return orig.call(this, input, init).then(
                function (res) { finish(); return res; },
                function (err) { finish(); throw err; }
            );
        };
        wrapped.__loadingWrapped = true;
        window.fetch = wrapped;
    }

    // ── forms that actually navigate (AJAX forms preventDefault; skip those) ──
    document.addEventListener('submit', function (e) {
        if (e.defaultPrevented) return;
        var form = e.target;
        if (!form || form.getAttribute('data-no-loading') !== null && form.hasAttribute('data-no-loading')) return;
        var btn = form.querySelector('button[type="submit"]:not([disabled]), input[type="submit"]:not([disabled]), button:not([type]):not([disabled])');
        if (btn) startBtn(btn);
        barStart(); // the new document clears it on load
    }, false);

    // ── link navigations: show the bar during the wait for the next page ──
    window.addEventListener('beforeunload', function () { barStart(); });
    // A bar left over from a navigation (incl. bfcache restore) is cleared here.
    window.addEventListener('pageshow', function () {
        active = 0;
        clearTimeout(showTimer);
        if (bar) { clearInterval(bar._creep); bar.classList.remove('active'); bar.style.width = '0'; }
    });

    // A small API for anything that wants to drive it explicitly.
    window.Loading = { startButton: startBtn, stopButton: stopBtn, barStart: barStart, barDone: barDone };
})();
