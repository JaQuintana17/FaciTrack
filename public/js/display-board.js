/**
 * The Faculty Lounge board, kept current.
 *
 * Written for a panel that is switched on once and then ignored for months, so
 * every failure mode has to recover by itself and none of them may leave the
 * screen quietly lying. Two rules follow from that:
 *
 *   - poll, do not stream. A dropped stream needs somebody to notice; a poll
 *     picks itself back up on the next tick.
 *   - when the poll fails, say so on the screen. Hours-old presence presented
 *     as current is worse than admitting the board is out of touch.
 */
(function () {
    'use strict';

    var REFRESH_MS = 20000;      // backstop: the stream is what normally wakes it
    var PAIRING_POLL_MS = 5000;  // an unpaired screen should light up promptly
    var STALE_AFTER_MS = 90000;  // how long before the screen admits it is behind
    var RELOAD_AFTER_MS = 1800000; // full reload every 30 min, to pick up new staff

    var board = window.BOARD || {};
    var status = board.status || 'pending';
    var lastGood = board.generatedAt ? new Date(board.generatedAt).getTime() : Date.now();
    var loadedAt = Date.now();

    var grid = document.getElementById('boardGrid');
    var updatedEl = document.getElementById('boardUpdated');
    var timeEl = document.getElementById('boardTime');
    var dateEl = document.getElementById('boardDate');

    // ── Clock ────────────────────────────────────────────────────────────
    function paintClock() {
        var now = new Date();
        var opts = { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Manila' };
        if (timeEl) timeEl.textContent = now.toLocaleTimeString('en-PH', opts);
        if (dateEl) {
            dateEl.textContent = now.toLocaleDateString('en-PH', {
                weekday: 'long', month: 'long', day: 'numeric', timeZone: 'Asia/Manila'
            });
        }
    }

    // ── Freshness ────────────────────────────────────────────────────────
    function describeAge(ms) {
        var seconds = Math.round(ms / 1000);
        if (seconds < 45) return 'just now';
        var minutes = Math.round(seconds / 60);
        if (minutes < 60) return minutes + (minutes === 1 ? ' minute ago' : ' minutes ago');
        var hours = Math.round(minutes / 60);
        return hours + (hours === 1 ? ' hour ago' : ' hours ago');
    }

    function paintFreshness() {
        var age = Date.now() - lastGood;
        if (updatedEl) updatedEl.textContent = describeAge(age);
        document.body.classList.toggle('stale', age > STALE_AFTER_MS);
    }

    // ── Rendering ────────────────────────────────────────────────────────
    function initials(name) {
        return String(name).split(/\s+/).filter(Boolean).slice(0, 2)
            .map(function (n) { return n[0]; }).join('').toUpperCase();
    }

    function presenceClass(presence) {
        if (presence === 'in-room') return 'in';
        if (presence === 'out-of-room') return 'out';
        return 'unknown';
    }

    function card(person) {
        var article = document.createElement('article');
        article.className = 'person ' + presenceClass(person.presence);

        var avatar = document.createElement('div');
        avatar.className = 'person-avatar';
        if (person.photo) {
            var img = document.createElement('img');
            img.src = person.photo;
            img.alt = '';
            avatar.appendChild(img);
        } else {
            avatar.textContent = initials(person.name);
        }

        var id = document.createElement('div');
        id.className = 'person-id';

        var name = document.createElement('div');
        name.className = 'person-name';
        name.textContent = person.name;

        var position = document.createElement('div');
        position.className = 'person-position';
        position.textContent = person.position;

        var availability = document.createElement('span');
        availability.className = 'person-availability ' + (person.availability || '');
        availability.textContent = person.availabilityLabel;

        id.appendChild(name);
        id.appendChild(position);
        id.appendChild(availability);

        var presence = document.createElement('div');
        presence.className = 'person-presence';
        var word = document.createElement('div');
        word.className = 'presence-word';
        word.textContent = person.presenceLabel;
        presence.appendChild(word);

        article.appendChild(avatar);
        article.appendChild(id);
        article.appendChild(presence);
        return article;
    }

    // Built as elements rather than innerHTML: these are real people's names
    // coming back over the wire, and a board on a wall is the last place to
    // find out that one of them contains markup.
    function paintBoard(faculty) {
        if (!grid) return;
        var next = document.createDocumentFragment();
        faculty.forEach(function (person) { next.appendChild(card(person)); });
        grid.replaceChildren(next);
    }

    /**
     * Say when the board cannot answer the question it exists to answer.
     *
     * Without a scanner watching the lounge, every card reads "No data" — and
     * a wall of that with no explanation looks like the screen is broken
     * rather than like the lounge is unmonitored.
     */
    function paintNotice(text) {
        var el = document.getElementById('boardNotice');
        if (!el) return;
        el.textContent = text || '';
        el.hidden = !text;
    }

    // ── Refresh ──────────────────────────────────────────────────────────
    function refresh() {
        fetch('/display/board.json', { cache: 'no-store' })
            .then(function (res) { return res.ok ? res.json() : null; })
            .then(function (data) {
                if (!data || !data.success) return;   // leave the last good board up

                // Approval, or its withdrawal, changes the whole page. Let the
                // server render it rather than trying to build a board out of
                // a screen that was showing a pairing code a second ago.
                if (data.status !== status) { window.location.reload(); return; }

                if (data.status === 'pending') {
                    // The code rotates; keep what is on the wall current so an
                    // admin is never told a code that has already lapsed.
                    var codeEl = document.getElementById('pairCode');
                    if (codeEl && data.pairingCode) codeEl.textContent = data.pairingCode;
                    lastGood = Date.now();
                    paintFreshness();
                    return;
                }

                paintBoard(data.faculty);
                paintNotice(data.coverageNotice);
                lastGood = new Date(data.generatedAt).getTime() || Date.now();
                paintFreshness();
            })
            .catch(function () {
                // Offline or the server is down. paintFreshness will mark the
                // board stale on its own once enough time has passed.
            });
    }

    /* ── Live updates ─────────────────────────────────────────────────────
       The board used to learn about an arrival only on its next poll, which
       put up to twenty seconds between somebody walking in and the wall
       agreeing. It now listens on the same event the scanners already emit,
       and keeps polling as a backstop for a dropped connection. */
    function listen() {
        if (status !== 'approved' || typeof EventSource === 'undefined') return;

        var stream = new EventSource('/display/events');
        stream.addEventListener('presence:changed', function () { refresh(); });

        // EventSource reconnects on its own, and the poll covers the gap while
        // it does. Closing here would turn a blip into a permanently dead
        // stream on a screen nobody is watching.
        stream.onerror = function () { /* handled by the backstop poll */ };
    }

    listen();
    paintClock();
    paintFreshness();

    setInterval(paintClock, 1000);
    setInterval(paintFreshness, 5000);
    setInterval(refresh, status === 'approved' ? REFRESH_MS : PAIRING_POLL_MS);

    // A long-lived page drifts: CSS and markup change, staff join and leave.
    // A periodic hard reload costs nothing on a screen nobody is reading and
    // saves a site visit.
    setInterval(function () {
        if (Date.now() - loadedAt > RELOAD_AFTER_MS) window.location.reload();
    }, 60000);
}());
