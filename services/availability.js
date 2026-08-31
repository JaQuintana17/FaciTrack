/**
 * What makes an instructor unavailable.
 *
 * Availability is decided in two very different places: inside SQL, when the
 * student-facing queries filter bookable slots, and in JavaScript, when the
 * make-up scheduler walks a window looking for a free hour. Rather than let
 * those two drift apart, the rule for external calendar events lives here in
 * both shapes and nowhere else.
 */

const CalendarModel = require('../models/CalendarModel');
const InstructorEventModel = require('../models/InstructorEventModel');

/**
 * A correlated NOT EXISTS that removes any slot covered by a blocking
 * calendar event — imported from a subscribed feed, or created by the
 * instructor here. Both are checked because both mean the same thing to a
 * student: the instructor is busy. Takes no parameters, so it drops straight
 * into an existing query without disturbing its placeholder order.
 *
 * @param {string} instructorColumn  column holding users.id  (e.g. 'u.id')
 * @param {string} dateColumn        the slot's DATE          (e.g. 'cs.consultation_date')
 * @param {string} startColumn       the slot's TIME          (e.g. 'cs.start_time')
 * @param {string} endColumn         the slot's TIME          (e.g. 'cs.end_time')
 */
function notBlockedByCalendarSql(instructorColumn, dateColumn, startColumn, endColumn) {
    // Wrapped in parentheses because blockedByCalendarSql() prefixes this with
    // NOT, and NOT binds tighter than AND — unparenthesised, a second AND-ed
    // term would fall outside the negation and inverate only the first.
    return `(NOT EXISTS (
        SELECT 1 FROM external_events ee
         WHERE ee.user_id = ${instructorColumn}
           AND ee.blocks = 1
           AND ee.event_date = ${dateColumn}
           AND (
               ee.all_day = 1
               OR (SEC_TO_TIME(ee.start_slot * 1800) < ${endColumn}
                   AND SEC_TO_TIME(ee.end_slot * 1800) > ${startColumn})
           )
    ) AND NOT EXISTS (
        SELECT 1 FROM instructor_events ie
         WHERE ie.instructor_id = ${instructorColumn}
           AND ie.blocks = 1
           AND ie.event_date = ${dateColumn}
           AND (
               ie.all_day = 1
               OR (SEC_TO_TIME(ie.start_slot * 1800) < ${endColumn}
                   AND SEC_TO_TIME(ie.end_slot * 1800) > ${startColumn})
           )
    ))`;
}

/**
 * The inverse: true when a calendar event does cover the slot. Used where a
 * slot is still shown to the student but marked with the reason it is closed,
 * rather than being filtered out of the list entirely.
 */
function blockedByCalendarSql(instructorColumn, dateColumn, startColumn, endColumn) {
    return `NOT ${notBlockedByCalendarSql(instructorColumn, dateColumn, startColumn, endColumn)}`;
}

/**
 * Blocking calendar events for one instructor, as date + half-hour slots.
 * The JavaScript-side counterpart of the SQL above.
 */
async function calendarBusyIntervals(instructorInternalId, startDate, endDate) {
    // Both sources, because the SQL rule above checks both. If these two ever
    // disagree the make-up scheduler will happily book over something the
    // student-facing query treats as blocked.
    const [imported, own] = await Promise.all([
        CalendarModel.getBusyIntervals(instructorInternalId, startDate, endDate).catch(err => {
            // A calendar problem must never make an instructor look free when
            // they are not — but nor should it take the booking page down.
            console.error('[Availability] Could not read imported events:', err.message);
            return [];
        }),
        InstructorEventModel.getBusyIntervals(instructorInternalId, startDate, endDate).catch(err => {
            console.error('[Availability] Could not read own events:', err.message);
            return [];
        }),
    ]);
    return imported.concat(own);
}

module.exports = {
    notBlockedByCalendarSql,
    blockedByCalendarSql,
    calendarBusyIntervals,
};
