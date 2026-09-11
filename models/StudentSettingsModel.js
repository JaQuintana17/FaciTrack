const pool = require('../configs/db');

/**
 * Per-student preferences from Student > Settings.
 *
 * Written lazily on the first save, exactly like instructor_settings, so a
 * student who has never opened the page still reads clean defaults.
 *
 * The department is deliberately not here — it is users.department_id, the same
 * column admin sets and every other query already joins on. A second copy would
 * be one more place for it to drift.
 */
const DEFAULTS = {
    directoryOwnDept: false,
};

function toSettings(row) {
    if (!row) return { ...DEFAULTS };
    return { directoryOwnDept: Boolean(row.directory_own_dept) };
}

const StudentSettingsModel = {

    DEFAULTS,

    async getByPublicId(publicId) {
        const [rows] = await pool.execute(
            `SELECT s.directory_own_dept
               FROM student_settings s
               JOIN users u ON u.id = s.user_id
              WHERE u.public_id = ?`,
            [publicId]
        );
        return toSettings(rows[0]);
    },

    /**
     * Save the preferences, creating the row on first use.
     *
     * @param {string} publicId  users.public_id
     * @param {{directoryOwnDept: boolean}} settings
     * @returns {Promise<boolean>} false when no such student
     */
    async save(publicId, settings) {
        const [[user]] = await pool.execute(
            `SELECT id FROM users WHERE public_id = ? AND role = 'Student'`,
            [publicId]
        );
        if (!user) return false;

        await pool.execute(
            `INSERT INTO student_settings (user_id, directory_own_dept)
                  VALUES (?, ?)
             ON DUPLICATE KEY UPDATE directory_own_dept = VALUES(directory_own_dept)`,
            [user.id, settings.directoryOwnDept ? 1 : 0]
        );
        return true;
    },

    /**
     * The student's own department.
     *
     * Kept beside the settings because the two are always read together: the
     * directory preference means nothing without a department to point at, and
     * the page has to disable the toggle when there is none.
     */
    async setDepartment(publicId, departmentId) {
        const [result] = await pool.execute(
            `UPDATE users SET department_id = ? WHERE public_id = ? AND role = 'Student'`,
            [departmentId || null, publicId]
        );
        return result.affectedRows > 0;
    },
};

module.exports = StudentSettingsModel;
