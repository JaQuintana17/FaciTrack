/**
 * Student appointments index.
 *
 * The list view is a grid of instructor cards; the calendar stays here because
 * it is the one view that spans every instructor. Clicking a day now opens
 * that instructor's history page with the booking highlighted, rather than
 * scrolling to a card that no longer exists on this page.
 */
(function () {
    'use strict';

    var APPOINTMENTS = window.STUDENT_APPOINTMENTS || [];
    var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                  'July', 'August', 'September', 'October', 'November', 'December'];

    // ── Instructor search ──
    window.CardFilter.create({
        cardSelector: '.inst-card',
        search: '#instSearch',
        count: '#instCount',
        empty: '#instEmpty',
        noun: 'instructor',
    });

    var listBtn = document.getElementById('btnListView');
    var calendarBtn = document.getElementById('btnCalendarView');
    var listView = document.getElementById('listViewContainer');
    var calendarView = document.getElementById('calendarViewContainer');
    var grid = document.getElementById('calendarGrid');

    // ── View toggle ──
    function showList() {
        listView.classList.add('active');
        calendarView.classList.remove('active');
        listBtn.classList.add('active');
        calendarBtn.classList.remove('active');
    }

    function showCalendar() {
        listView.classList.remove('active');
        calendarView.classList.add('active');
        calendarBtn.classList.add('active');
        listBtn.classList.remove('active');
        renderCalendar();
    }

    listBtn.addEventListener('click', showList);
    calendarBtn.addEventListener('click', showCalendar);

    // ── Calendar ──
    var currentMonth = new Date().getMonth();
    var currentYear = new Date().getFullYear();

    function dayCell(number, extraClass) {
        var el = document.createElement('div');
        el.className = 'calendar-day' + (extraClass ? ' ' + extraClass : '');
        var num = document.createElement('div');
        num.className = 'calendar-day-number';
        num.textContent = number;
        el.appendChild(num);
        return el;
    }

    function renderCalendar() {
        if (!grid) return;

        document.getElementById('calendarMonthYear').textContent =
            MONTHS[currentMonth] + ' ' + currentYear;

        var headers = Array.prototype.slice.call(grid.querySelectorAll('.calendar-day-header'));
        grid.innerHTML = '';
        headers.forEach(function (h) { grid.appendChild(h); });

        var firstDay = new Date(currentYear, currentMonth, 1).getDay();
        var daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
        var daysInPrevMonth = new Date(currentYear, currentMonth, 0).getDate();

        var byDate = {};
        APPOINTMENTS.forEach(function (apt) {
            var d = new Date(apt.date);
            var key = d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
            (byDate[key] = byDate[key] || []).push(apt);
        });

        var today = new Date();
        today.setHours(0, 0, 0, 0);

        for (var i = firstDay - 1; i >= 0; i--) {
            grid.appendChild(dayCell(daysInPrevMonth - i, 'other-month'));
        }

        for (var day = 1; day <= daysInMonth; day++) {
            var date = new Date(currentYear, currentMonth, day);
            date.setHours(0, 0, 0, 0);
            var dayApts = byDate[currentYear + '-' + currentMonth + '-' + day] || [];

            var cell = dayCell(day, date.getTime() === today.getTime() ? 'today' : '');

            if (dayApts.length) {
                cell.classList.add('has-appointments');

                var dots = document.createElement('div');
                dots.className = 'calendar-day-dots';
                dayApts.forEach(function (apt) {
                    var dot = document.createElement('div');
                    dot.className = 'calendar-day-dot ' + apt.status;
                    dot.title = apt.facultyDisplayName + ' — ' + apt.status;
                    dots.appendChild(dot);
                });
                cell.appendChild(dots);

                // Straight to the booking rather than back to a list to hunt in
                cell.style.cursor = 'pointer';
                (function (apt) {
                    cell.addEventListener('click', function () {
                        window.location.href = '/student/appointments/' +
                            encodeURIComponent(apt.instructorId) +
                            '?openApt=' + encodeURIComponent(apt.id);
                    });
                }(dayApts[0]));
            }

            grid.appendChild(cell);
        }

        var totalCells = firstDay + daysInMonth;
        var remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
        for (var next = 1; next <= remaining; next++) {
            grid.appendChild(dayCell(next, 'other-month'));
        }
    }

    document.getElementById('btnPrevMonth').addEventListener('click', function () {
        currentMonth--;
        if (currentMonth < 0) { currentMonth = 11; currentYear--; }
        renderCalendar();
    });

    document.getElementById('btnNextMonth').addEventListener('click', function () {
        currentMonth++;
        if (currentMonth > 11) { currentMonth = 0; currentYear++; }
        renderCalendar();
    });

    renderCalendar();
}());
