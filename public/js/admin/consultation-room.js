/**
 * Consultation Room — the administrator's week view of every consultation.
 *
 * The server hands over one week of slots at a time; the mini calendar picks
 * the date, and the status filter narrows what is already loaded so it
 * applies without a round trip.
 */
(function () {
    'use strict';

    var DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    var DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
    var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];

    var START_HOUR = 7;   // 7:00 AM
    var END_HOUR = 20;    // 8:00 PM

    var data = window.CONSULT_DATA || {};

    var state = {
        weekStart: data.startDate || isoToday(),
        selectedDate: data.startDate || isoToday(),
        miniMonth: null,          // {year, month} — set on first render
        slots: [],
        loading: false,
    };

    /* ── Dates ──
       Everything is handled as YYYY-MM-DD strings in UTC. Parsing a bare date
       with `new Date('2026-08-28')` is UTC but `new Date('2026-08-28T00:00:00')`
       is local, and mixing the two shifts days across timezones. */

    function isoToday() {
        var now = new Date();
        return toIso(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    }

    function toIso(ms) { return new Date(ms).toISOString().slice(0, 10); }
    function parseIso(iso) { return Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)); }
    function addDays(iso, n) { return toIso(parseIso(iso) + n * 86400000); }

    /** Monday of the week containing `iso`. */
    function mondayOf(iso) {
        var d = new Date(parseIso(iso));
        return toIso(parseIso(iso) - ((d.getUTCDay() + 6) % 7) * 86400000);
    }

    function weekNumber(iso) {
        // ISO-8601: week 1 is the one holding the first Thursday
        var thursday = new Date(parseIso(mondayOf(iso)) + 3 * 86400000);
        var jan1 = Date.UTC(thursday.getUTCFullYear(), 0, 1);
        return Math.floor((thursday.getTime() - jan1) / 86400000 / 7) + 1;
    }

    function longDate(iso) {
        var d = new Date(parseIso(iso));
        return MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + d.getUTCFullYear();
    }

    /** "14:30:00" → "2:30 PM" */
    function timeLabel(time) {
        var parts = String(time || '').split(':');
        var h = parseInt(parts[0], 10);
        var m = parts[1] || '00';
        if (isNaN(h)) return String(time || '');
        var period = h < 12 ? 'AM' : 'PM';
        var h12 = h % 12 === 0 ? 12 : h % 12;
        return h12 + ':' + m + ' ' + period;
    }

    function hourOf(time) { return parseInt(String(time || '0').split(':')[0], 10) || 0; }

    /* ── Data ── */

    function load() {
        state.loading = true;

        var params = new URLSearchParams({
            start: state.weekStart,
            end: addDays(state.weekStart, 6),
        });
        var instructor = document.getElementById('filterInstructor').value;
        if (instructor) params.set('instructor', instructor);

        return fetch('/admin/consultation-room/slots?' + params.toString())
            .then(function (res) { return res.json(); })
            .then(function (json) {
                if (!json.success) throw new Error(json.error || 'Failed to load.');
                state.slots = json.slots || [];
                render();
            })
            .catch(function (err) {
                state.slots = [];
                render();
                showToast('error', 'Could not load slots', err.message);
            })
            .finally(function () { state.loading = false; });
    }

    /** The status filter narrows what is already loaded. */
    function visibleSlots() {
        var status = document.getElementById('filterStatus').value;
        if (!status) return state.slots;
        return state.slots.filter(function (s) { return s.state === status; });
    }

    /* ── Rendering ── */

    function render() {
        var slots = visibleSlots();
        renderStats(slots);
        renderWeek(slots);
        renderMiniCalendar();
        renderWeekLabel();
    }

    function renderStats(slots) {
        var counts = { Booking: 0, Pending: 0, Confirmed: 0, Completed: 0 };
        slots.forEach(function (s) { counts[s.state] = (counts[s.state] || 0) + 1; });

        document.getElementById('totalSlotsCount').textContent = slots.length;
        document.getElementById('pendingCount').textContent = counts.Pending;
        document.getElementById('confirmedCount').textContent = counts.Confirmed;
        document.getElementById('completedCount').textContent = counts.Completed;
    }

    function renderWeekLabel() {
        var end = addDays(state.weekStart, 6);
        document.getElementById('weekLabel').textContent = longDate(state.weekStart) + ' – ' + longDate(end);
        document.getElementById('weekBadge').textContent = 'Week ' + weekNumber(state.weekStart);
    }

    function renderWeek(slots) {
        var grid = document.getElementById('weekGrid');
        var empty = document.getElementById('weekEmpty');
        var today = isoToday();

        grid.innerHTML = '';
        empty.hidden = slots.length > 0;

        // Bucket by date and starting hour so each cell knows its own slots
        var byCell = {};
        var perDay = {};
        slots.forEach(function (s) {
            var date = String(s.date).slice(0, 10);
            var hour = Math.min(Math.max(hourOf(s.startTime), START_HOUR), END_HOUR - 1);
            (byCell[date + '_' + hour] = byCell[date + '_' + hour] || []).push(s);
            perDay[date] = (perDay[date] || 0) + 1;
        });

        // Header row
        grid.appendChild(el('div', 'cr-corner'));
        for (var d = 0; d < 7; d++) {
            var date = addDays(state.weekStart, d);
            var head = el('div', 'cr-day-head' + (date === today ? ' is-today' : ''));
            head.innerHTML =
                '<span class="cr-day-name"></span>' +
                '<span class="cr-day-date"></span>' +
                '<span class="cr-day-count"></span>';
            head.querySelector('.cr-day-name').textContent = DAYS[d].slice(0, 3);
            head.querySelector('.cr-day-date').textContent = new Date(parseIso(date)).getUTCDate();
            head.querySelector('.cr-day-count').textContent =
                perDay[date] ? perDay[date] + (perDay[date] === 1 ? ' slot' : ' slots') : '—';
            grid.appendChild(head);
        }

        // Hour rows
        for (var h = START_HOUR; h < END_HOUR; h++) {
            var gutter = el('div', 'cr-hour');
            gutter.textContent = timeLabel(h + ':00');
            grid.appendChild(gutter);

            for (var i = 0; i < 7; i++) {
                var cellDate = addDays(state.weekStart, i);
                var cell = el('div', 'cr-cell' + (cellDate === today ? ' is-today' : ''));
                (byCell[cellDate + '_' + h] || []).forEach(function (slot) {
                    cell.appendChild(blockFor(slot));
                });
                grid.appendChild(cell);
            }
        }
    }

    function blockFor(slot) {
        var block = el('button', 'cr-block ' + blockClass(slot));
        block.type = 'button';
        block.innerHTML = '<strong></strong><span></span>';
        // The row gives the hour, but a slot can start on the half hour, so the
        // exact time rides with the student rather than crowding the name.
        block.querySelector('strong').textContent = slot.instructorName;
        block.querySelector('span').textContent =
            timeLabel(slot.startTime) + ' · ' + (slot.studentName || slot.state);
        block.addEventListener('click', function (e) {
            e.stopPropagation();
            openPopover(slot, block);
        });
        return block;
    }

    function blockClass(slot) {
        return slot.state.toLowerCase();   // booking | pending | confirmed | completed
    }

    function renderMiniCalendar() {
        if (!state.miniMonth) {
            var d = new Date(parseIso(state.selectedDate));
            state.miniMonth = { year: d.getUTCFullYear(), month: d.getUTCMonth() };
        }

        var year = state.miniMonth.year;
        var month = state.miniMonth.month;
        var grid = document.getElementById('miniCalGrid');
        var today = isoToday();
        var weekEnd = addDays(state.weekStart, 6);

        // Days that actually have slots, so the month shows where activity is
        var withSlots = {};
        state.slots.forEach(function (s) { withSlots[String(s.date).slice(0, 10)] = true; });

        document.getElementById('miniMonthLabel').textContent = MONTHS[month] + ' ' + year;
        grid.innerHTML = '';

        DOW.forEach(function (label) {
            var head = el('div', 'cr-mini-dow');
            head.textContent = label;
            grid.appendChild(head);
        });

        // Lead in from the Monday of the week the 1st falls in
        var first = Date.UTC(year, month, 1);
        var lead = (new Date(first).getUTCDay() + 6) % 7;
        var cursor = toIso(first - lead * 86400000);

        for (var i = 0; i < 42; i++) {
            var iso = addDays(cursor, i);
            var date = new Date(parseIso(iso));
            var classes = ['cr-mini-day'];

            if (date.getUTCMonth() !== month) classes.push('muted');
            if (iso === today) classes.push('today');
            if (iso >= state.weekStart && iso <= weekEnd) classes.push('in-week');
            if (iso === state.selectedDate) classes.push('selected');

            var button = el('button', classes.join(' '));
            button.type = 'button';
            button.dataset.date = iso;
            button.innerHTML = '<span></span>' + (withSlots[iso] ? '<i class="cr-mini-dot"></i>' : '');
            button.querySelector('span').textContent = date.getUTCDate();
            grid.appendChild(button);
        }
    }

    /* ── Slot popover ── */

    function openPopover(slot, anchor) {
        var pop = document.getElementById('slotPopover');
        var inner = document.getElementById('slotPopoverInner');

        var rows = [
            ['Status', slot.state],
            ['Instructor', slot.instructorName],
            ['Department', slot.department],
            ['Student', slot.studentName],
            ['Student no.', slot.studentNumber],
            ['Section', slot.section],
            ['Subject', slot.courseSubject],
            ['Topic', slot.topic],
            ['Room', slot.roomNumber],
        ].filter(function (r) { return r[1]; });

        inner.innerHTML =
            '<p class="cr-pop-title"></p><p class="cr-pop-time"></p>' +
            rows.map(function () {
                return '<dl class="cr-pop-row"><dt></dt><dd></dd></dl>';
            }).join('');

        inner.querySelector('.cr-pop-title').textContent = slot.instructorName;
        inner.querySelector('.cr-pop-time').textContent =
            longDate(String(slot.date).slice(0, 10)) + ' · ' +
            timeLabel(slot.startTime) + ' – ' + timeLabel(slot.endTime);

        var dls = inner.querySelectorAll('.cr-pop-row');
        rows.forEach(function (row, i) {
            dls[i].querySelector('dt').textContent = row[0];
            dls[i].querySelector('dd').textContent = row[1];
        });

        document.querySelectorAll('.cr-block.is-selected')
            .forEach(function (b) { b.classList.remove('is-selected'); });
        anchor.classList.add('is-selected');

        // Shown before measuring — offsetWidth/Height are 0 while it is display:none
        pop.classList.add('open');
        position(pop, anchor);
    }

    /**
     * Sit the popover against its block: below by default, flipped above when
     * the bottom of the window is too close, and never past either edge.
     */
    function position(pop, anchor) {
        var GAP = 6;
        var EDGE = 8;

        var box = anchor.getBoundingClientRect();
        var width = pop.offsetWidth;
        var height = pop.offsetHeight;

        var left = Math.max(EDGE, Math.min(box.left, window.innerWidth - width - EDGE));

        var top;
        if (box.bottom + GAP + height <= window.innerHeight - EDGE) {
            top = box.bottom + GAP;                     // below, the usual case
        } else if (box.top - GAP - height >= EDGE) {
            top = box.top - GAP - height;               // above, when the bottom is tight
        } else {
            top = Math.max(EDGE, window.innerHeight - height - EDGE);  // taller than the gap either way
        }

        // Document coordinates, so scrolling the page carries it along
        pop.style.left = (left + window.scrollX) + 'px';
        pop.style.top = (top + window.scrollY) + 'px';
    }

    function closePopover() {
        document.getElementById('slotPopover').classList.remove('open');
        document.querySelectorAll('.cr-block.is-selected')
            .forEach(function (b) { b.classList.remove('is-selected'); });
    }

    /* ── Helpers ── */

    function el(tag, className) {
        var node = document.createElement(tag);
        node.className = className;
        return node;
    }

    function showToast(type, title, message) {
        var container = document.getElementById('toastContainer');
        if (!container) return;
        var toast = el('div', 'toast ' + type);
        toast.innerHTML = '<div class="toast-content"><p class="toast-title"></p><p class="toast-message"></p></div>';
        toast.querySelector('.toast-title').textContent = title;
        toast.querySelector('.toast-message').textContent = message;
        container.appendChild(toast);
        setTimeout(function () {
            toast.style.opacity = '0';
            setTimeout(function () { toast.remove(); }, 300);
        }, 4000);
    }

    /** Move to the week holding `iso` and reload, keeping the day selected. */
    function goToDate(iso) {
        state.selectedDate = iso;
        var monday = mondayOf(iso);
        if (monday === state.weekStart) { render(); return; }
        state.weekStart = monday;
        closePopover();
        load();
    }

    /* ── Wire ── */

    function wire() {
        document.getElementById('prevWeekBtn').addEventListener('click', function () {
            goToDate(addDays(state.weekStart, -7));
        });
        document.getElementById('nextWeekBtn').addEventListener('click', function () {
            goToDate(addDays(state.weekStart, 7));
        });
        document.getElementById('todayBtn').addEventListener('click', function () {
            var today = isoToday();
            state.miniMonth = {
                year: new Date(parseIso(today)).getUTCFullYear(),
                month: new Date(parseIso(today)).getUTCMonth(),
            };
            goToDate(today);
        });

        document.getElementById('miniPrevMonth').addEventListener('click', function () {
            stepMonth(-1);
        });
        document.getElementById('miniNextMonth').addEventListener('click', function () {
            stepMonth(1);
        });
        document.getElementById('miniCalGrid').addEventListener('click', function (e) {
            var day = e.target.closest('.cr-mini-day');
            if (!day) return;
            var iso = day.dataset.date;
            var d = new Date(parseIso(iso));
            state.miniMonth = { year: d.getUTCFullYear(), month: d.getUTCMonth() };
            goToDate(iso);
        });

        // The instructor filter is applied by the server, so it refetches;
        // status narrows what is already here. Both act on change — there is no
        // Apply step.
        document.getElementById('filterInstructor').addEventListener('change', load);
        document.getElementById('filterStatus').addEventListener('change', render);

        document.getElementById('clearFiltersBtn').addEventListener('click', function () {
            document.getElementById('filterInstructor').value = '';
            document.getElementById('filterStatus').value = '';
            load();
        });

        document.addEventListener('click', function (e) {
            if (!e.target.closest('.cr-popover') && !e.target.closest('.cr-block')) closePopover();
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') closePopover();
        });

        // The grid scrolls sideways on its own, which would slide the block out
        // from under the popover. Close rather than leave it stranded.
        document.querySelector('.cr-week-grid-wrap').addEventListener('scroll', closePopover);
        window.addEventListener('resize', closePopover);
    }

    function stepMonth(delta) {
        var month = state.miniMonth.month + delta;
        var year = state.miniMonth.year + Math.floor(month / 12);
        state.miniMonth = { year: year, month: ((month % 12) + 12) % 12 };
        renderMiniCalendar();
    }

    function init() {
        state.weekStart = mondayOf(state.weekStart);
        wire();
        load();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
