/**
 * Where a notification should land, as an app-relative path.
 *
 * The bell, Web Push and email all link back into the app, and each used to
 * build that link itself — so when make-up notifications arrived, two of the
 * three still pointed at the appointments page. One function now serves all
 * three; anything that adds a notification type only has to change it here.
 */

const APPOINTMENTS_BY_ROLE = {
    Instructor: '/instructor/appointments',
    Student: '/student/appointments',
};

const MAKEUP_BY_ROLE = {
    Dean: '/dean/makeup/requests',
    Instructor: '/instructor/makeup/requests',
};

/**
 * @param {number|null} appointmentId  expands that booking when present
 * @param {string} role                users.role
 * @param {string} type                notifications.type
 * @returns {string|null}              null when this role has no page for it
 */
function deepLink(appointmentId, role, type) {
    if (type === 'makeup') return MAKEUP_BY_ROLE[role] || null;

    // A dean has no appointments page, but they are told about bookings that
    // have gone unanswered — and the report listing those is where that
    // notification should land.
    if (role === 'Dean') return appointmentId ? '/dean/reports' : null;

    const path = APPOINTMENTS_BY_ROLE[role];
    if (!path) return null;   // admins have no appointments page
    return appointmentId ? `${path}?openApt=${encodeURIComponent(appointmentId)}` : path;
}

module.exports = { deepLink };
