/**
 * Admin → BLE Devices.
 *
 * Assigning tags, tuning a room's threshold, and keeping the health view true.
 *
 * The page used to reload itself on a timer, which threw away scroll position
 * and flashed the whole screen every twenty seconds. Now a `presence:changed`
 * event nudges it and only the affected cells are rewritten. A slow poll stays
 * as a backstop, because a scanner going *silent* produces no event — and the
 * absence of news is exactly what a health page has to notice.
 */
(function () {
    'use strict';

    // The server owns these rules and hands them over; the page only applies them
    var SCANNER_OFFLINE_AFTER = window.__SCANNER_OFFLINE_AFTER__ || 60;
    var TAG_OFFLINE_AFTER = window.__TAG_OFFLINE_AFTER__ || 120;

    // Staleness is now decided locally every few seconds, so this poll exists
    // only to pick up data that genuinely changed on the server.
    var BACKSTOP_MS = 30000;

    function showToast(type, title, message) {
        var container = document.getElementById('toastContainer');
        if (!container) return;
        var toast = document.createElement('div');
        toast.className = 'toast ' + type;
        toast.innerHTML = '<div class="toast-content"><p class="toast-title"></p><p class="toast-message"></p></div>';
        toast.querySelector('.toast-title').textContent = title;
        toast.querySelector('.toast-message').textContent = message;
        container.appendChild(toast);
        setTimeout(function () {
            toast.style.opacity = '0';
            setTimeout(function () { toast.remove(); }, 300);
        }, 4000);
    }

    function send(url, method, body) {
        return fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: body ? JSON.stringify(body) : undefined,
        })
            .then(function (res) { return res.json().catch(function () { return {}; }); })
            .catch(function () { return { success: false, error: 'Network error. Please try again.' }; });
    }

    /* ── Relative times ── */

    function timeAgo(iso) {
        var seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
        if (isNaN(seconds)) return '—';
        if (seconds < 5) return 'just now';
        if (seconds < 60) return seconds + 's ago';
        if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
        if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
        return Math.floor(seconds / 86400) + 'd ago';
    }

    /** "2h 14m" — a scanner's uptime falling is how you spot a reboot. */
    function uptime(seconds) {
        seconds = Number(seconds) || 0;
        if (!seconds) return '—';
        var d = Math.floor(seconds / 86400);
        var h = Math.floor((seconds % 86400) / 3600);
        var m = Math.floor((seconds % 3600) / 60);
        if (d) return d + 'd ' + h + 'h';
        if (h) return h + 'h ' + m + 'm';
        if (m) return m + 'm';
        return seconds + 's';
    }

    function paint() {
        document.querySelectorAll('[data-since]').forEach(function (el) {
            el.textContent = timeAgo(el.dataset.since);
        });
        document.querySelectorAll('[data-uptime]').forEach(function (el) {
            el.textContent = uptime(el.dataset.uptime);
        });
        evaluateStaleness();
    }

    /**
     * Decide online/offline here rather than waiting for the server.
     *
     * Going *offline* is the absence of a report, so nothing ever arrives to
     * announce it — an event-driven page would sit on a stale "Online" until
     * the next poll. But staleness is only elapsed time against a last-seen
     * stamp the page already has, so it can be worked out locally, every few
     * seconds, without asking anyone.
     *
     * The server still owns the rule; it hands over the cutoffs and this
     * applies them. A refresh overwrites these stamps with fresher ones.
     */
    function evaluateStaleness() {
        var now = Date.now();

        function ageOf(row) {
            var since = row.querySelector('[data-since]');
            if (!since || !since.dataset.since) return null;
            var ms = new Date(since.dataset.since).getTime();
            return isNaN(ms) ? null : (now - ms) / 1000;
        }

        var scannersOnline = 0;
        var scanners = document.querySelectorAll('tr[data-room-id]');
        scanners.forEach(function (tr) {
            var age = ageOf(tr);
            var online = age !== null && age <= SCANNER_OFFLINE_AFTER;
            if (online) scannersOnline++;
            tr.classList.toggle('is-offline', !online);
            setPill(tr.cells[0], online, 'Online', 'Offline');
        });

        var tagsOnline = 0;
        document.querySelectorAll('tr[data-id]').forEach(function (tr) {
            var age = ageOf(tr);
            var online = age !== null && age <= TAG_OFFLINE_AFTER;
            if (online) tagsOnline++;
            tr.classList.toggle('is-offline', !online);
            setPill(tr.cells[0], online, 'Live', 'Quiet');
        });

        // The tiles count the same rows, so they cannot disagree with them
        var tiles = document.querySelectorAll('.bx-stat .bx-stat-value');
        if (tiles[0]) tiles[0].innerHTML = scannersOnline + '<span>/' + scanners.length + '</span>';
        if (tiles[2]) tiles[2].textContent = tagsOnline;

        var first = document.querySelector('.bx-stat');
        if (first) {
            first.classList.remove('good', 'warn', 'bad');
            first.classList.add(scanners.length && scannersOnline === scanners.length ? 'good'
                : (scannersOnline ? 'warn' : 'bad'));
        }
    }

    /* ── Live refresh ──
       Only changed values are rewritten. Rebuilding the tables would destroy a
       half-typed label or an open dropdown, which is the whole reason the
       reload was worth removing in the first place. */

    var refreshing = false;

    function isEditing() {
        var el = document.activeElement;
        return el && (el.tagName === 'INPUT' || el.tagName === 'SELECT');
    }

    function setPill(cell, online, onText, offText) {
        var pill = cell.querySelector('.bx-pill');
        if (!pill) return;
        pill.classList.toggle('ok', online);
        pill.classList.toggle('off', !online);
        pill.textContent = online ? onText : offText;
    }

    function applyScanners(rows) {
        rows.forEach(function (s) {
            var tr = document.querySelector('tr[data-room-id="' + s.room_id + '"]');
            if (!tr) return;
            var since = tr.querySelector('[data-since]');
            if (since) { since.dataset.since = s.last_seen_at; since.textContent = timeAgo(s.last_seen_at); }

            var up = tr.querySelector('[data-uptime]');
            if (up) { up.dataset.uptime = s.last_uptime_sec || 0; up.textContent = uptime(s.last_uptime_sec); }

            var hearing = tr.cells[5];
            if (!hearing) return;
            if (s.tags_heard) {
                hearing.innerHTML = '<span class="bx-range"></span><span class="bx-muted bx-sub"></span>';
                hearing.querySelector('.bx-range').textContent = s.strongest + ' … ' + s.weakest + ' dBm';
                hearing.querySelector('.bx-sub').textContent =
                    s.tags_heard + ' tag' + (s.tags_heard === 1 ? '' : 's') + ' in 5 min';
            } else {
                hearing.innerHTML = '<span class="bx-muted">nothing heard</span>';
            }
        });
    }

    function applyTags(rows) {
        rows.forEach(function (b) {
            var tr = document.querySelector('tr[data-id="' + b.id + '"]');
            if (!tr) return;
            var statusCell = tr.cells[0];

            // The in-room pill comes and goes as people move
            var inRoom = statusCell.querySelector('.bx-pill.in-room');
            if (b.instructor_id && b.is_present) {
                if (!inRoom) {
                    inRoom = document.createElement('span');
                    inRoom.className = 'bx-pill in-room';
                    statusCell.appendChild(inRoom);
                }
                inRoom.textContent = 'In ' + (b.present_room || 'room');
            } else if (inRoom) {
                inRoom.remove();
            }

            var since = tr.querySelector('[data-since]');
            if (since && b.last_seen_at) {
                since.dataset.since = b.last_seen_at;
                since.textContent = timeAgo(b.last_seen_at);
            }

            var signal = tr.querySelector('.bx-signal');
            if (signal && b.last_rssi !== null && b.last_rssi !== undefined) {
                signal.textContent = b.last_rssi + ' dBm';
                var strong = b.last_rssi >= (window.__RSSI_THRESHOLD__ || -75);
                signal.classList.toggle('strong', strong);
                signal.classList.toggle('weak', !strong);
            }
        });
    }

    /** Only the counts staleness does not own — the rest is worked out locally. */
    function applyStats(stats) {
        var tiles = document.querySelectorAll('.bx-stat .bx-stat-value');
        if (tiles[1]) tiles[1].innerHTML = stats.tagsAssigned + '<span>/' + stats.tagsTotal + '</span>';
    }

    function refresh() {
        if (refreshing || document.hidden) return;
        refreshing = true;

        fetch('/admin/beacons.json')
            .then(function (res) { return res.json(); })
            .then(function (data) {
                if (!data.success) return;

                // Patching only ever rewrites status, times and signal — never a
                // label or a dropdown — so it is safe to do while someone types.
                applyScanners(data.scanners);
                applyTags(data.beacons);
                applyStats(data.stats);
                evaluateStaleness();

                // A tag or scanner that did not exist when the page rendered has
                // no row to patch, and only server-rendered markup will do. That
                // full load waits until nobody is mid-edit, so an arriving tag
                // never throws away a half-typed label.
                var isNew = data.beacons.some(function (b) {
                    return !document.querySelector('tr[data-id="' + b.id + '"]');
                }) || data.scanners.some(function (s) {
                    return s.room_id && !document.querySelector('tr[data-room-id="' + s.room_id + '"]');
                });
                if (isNew && !isEditing()) location.reload();
            })
            .catch(function () { /* the backstop will try again */ })
            .finally(function () { refreshing = false; });
    }

    /* ── Actions ── */

    document.addEventListener('click', function (e) {
        var button = e.target.closest('[data-action]');
        if (!button) return;

        var row = button.closest('tr');
        var id = row.dataset.id;

        if (button.dataset.action === 'save') {
            button.disabled = true;
            send('/admin/beacons/' + id, 'PATCH', {
                instructorId: row.querySelector('[data-field="instructor"]').value || null,
                label: row.querySelector('[data-field="label"]').value.trim(),
            }).then(function (data) {
                button.disabled = false;
                if (!data.success) return showToast('error', 'Not saved', data.error || 'Could not save the tag.');
                row.classList.toggle('unassigned', !row.querySelector('[data-field="instructor"]').value);
                showToast('success', 'Saved', 'Tag updated.');
            });
        }

        if (button.dataset.action === 'save-threshold') {
            var roomId = row.dataset.roomId;
            var field = row.querySelector('[data-field="threshold"]');
            button.disabled = true;
            send('/admin/rooms/' + roomId + '/threshold', 'PATCH', { threshold: field.value.trim() })
                .then(function (data) {
                    button.disabled = false;
                    if (!data.success) return showToast('error', 'Not saved', data.error || 'Could not save the threshold.');
                    var note = row.querySelector('[data-threshold-note]');
                    if (note) note.textContent = data.threshold === null ? 'using the default' : 'tuned for this room';
                    showToast('success', 'Saved',
                        data.threshold === null
                            ? 'This room follows the default again.'
                            : 'This room now uses ' + data.threshold + ' dBm.');
                });
        }

        if (button.dataset.action === 'remove') {
            // Safe: the tag reappears unassigned the next time a scanner hears
            // it, so this is undone by leaving it switched on.
            if (!confirm('Forget this tag? It will reappear unassigned if a scanner hears it again.')) return;
            send('/admin/beacons/' + id, 'DELETE').then(function (data) {
                if (!data.success) return showToast('error', 'Not removed', data.error || 'Could not remove the tag.');
                row.remove();
                showToast('success', 'Removed', 'Tag forgotten.');
            });
        }
    });

    /* ── Wiring ── */

    /** The Live badge should say what is actually true of the connection. */
    function markLive(connected) {
        var badge = document.getElementById('bxLive');
        if (!badge) return;
        badge.classList.toggle('is-down', !connected);
        badge.title = connected
            ? 'Connected — updates arrive as they happen'
            : 'Live connection lost — falling back to periodic checks';
    }

    if (window.Realtime) {
        window.Realtime.on('presence:changed', refresh);
        window.Realtime.on('connection:open', function () { markLive(true); });
        window.Realtime.on('connection:error', function () { markLive(false); });
    }

    // A scanner falling silent sends nothing, so only elapsed time reveals it
    setInterval(refresh, BACKSTOP_MS);

    paint();
    setInterval(paint, 5000);
})();
