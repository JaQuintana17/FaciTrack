/**
 * Dean Reports.
 *
 * Three plain tables — faculty roster, make-up requests, presence history —
 * each with search, filters and pagination. They share one small controller
 * rather than three near-identical copies, so a fix to paging or filtering
 * lands on all of them at once.
 *
 * Rows are rendered from data the server already put on the page; nothing here
 * fetches. Filtering is done over the array, not the DOM, so a search never
 * has to reason about which page is currently drawn.
 */
(function () {
    'use strict';

    var createTable = window.ReportTable.create;
    var esc = window.ReportTable.escapeHtml;

    // ── Faculty roster ───────────────────────────────────────────────────────
    var PRESENCE_BADGE = {
        'in-room': '<span class="table-badge confirmed">In Room</span>',
        'out-of-room': '<span class="table-badge declined">Out of Room</span>',
        'unknown': '<span class="table-badge">No data</span>',
    };

    function availPill(row) {
        return '<span class="avail-pill ' + esc(row.availability || 'none') + '">' +
            esc(row.availabilityLabel || 'Not set') + '</span>';
    }

    createTable(document.querySelector('[data-table="faculty"]'), {
        rows: window.DEAN_REPORTS.faculty,
        noun: 'instructor',
        title: 'Faculty Roster',
        searchText: function (r) { return r.name + ' ' + r.position + ' ' + r.officeRoom; },
        render: function (r) {
            return '<td><strong>' + esc(r.name) + '</strong></td>' +
                '<td>' + esc(r.position) + '</td>' +
                '<td>' + esc(r.officeRoom) + '</td>' +
                '<td>' + availPill(r) + '</td>' +
                '<td>' + (PRESENCE_BADGE[r.bleStatus] || PRESENCE_BADGE.unknown) + '</td>' +
                '<td style="text-align:center">' + esc(r.hoursThisMonth) + 'h</td>' +
                '<td style="text-align:center">' + esc(r.consultationsThisMonth) + '</td>' +
                '<td style="text-align:center">' + esc(r.avgDuration || '—') + '</td>';
        },
    });

    // ── Make-up requests ─────────────────────────────────────────────────────
    var STATUS_BADGE = {
        pending: '<span class="table-badge pending">Pending</span>',
        approved: '<span class="table-badge confirmed">Approved</span>',
        declined: '<span class="table-badge declined">Declined</span>',
    };

    createTable(document.querySelector('[data-table="makeup"]'), {
        rows: window.DEAN_REPORTS.makeupRequests,
        noun: 'request',
        title: 'Make-Up Class Requests',
        searchText: function (r) {
            return r.instructorName + ' ' + r.subject + ' ' + r.subjectName + ' ' + r.section;
        },
        render: function (r) {
            return '<td><strong>' + esc(r.instructorName) + '</strong></td>' +
                '<td>' + esc(r.subject) + (r.subjectName
                    ? '<span style="display:block;font-size:.72rem;color:var(--gray-500)">' + esc(r.subjectName) + '</span>'
                    : '') + '</td>' +
                '<td>' + esc(r.section) + '</td>' +
                '<td style="text-align:center">' + esc(r.sessionCount) + '</td>' +
                '<td style="white-space:nowrap">' + esc(r.firstDate || '—') + '</td>' +
                '<td>' + esc(r.rooms) + '</td>' +
                '<td>' + (STATUS_BADGE[r.status] || esc(r.status)) + '</td>' +
                '<td>' + esc(r.decidedBy || '—') + '</td>' +
                '<td style="white-space:nowrap">' + esc(r.submittedAt || '—') + '</td>';
        },
    });

    // ── Presence history ─────────────────────────────────────────────────────
    createTable(document.querySelector('[data-table="presence"]'), {
        rows: window.DEAN_REPORTS.presenceLogs,
        noun: 'detection',
        title: 'Faculty Presence History',
        searchText: function (r) { return r.facultyName + ' ' + r.location; },
        render: function (r) {
            var entered = r.status === 'entered';
            return '<td><span class="table-badge ' + (entered ? 'confirmed' : '') + '">' +
                    (entered ? 'Entered' : 'Exited') + '</span></td>' +
                '<td><strong>' + esc(r.facultyName) + '</strong></td>' +
                '<td>' + esc(r.location) + '</td>' +
                '<td style="white-space:nowrap">' + esc(r.relative || '—') + '</td>';
        },
    });
}());
