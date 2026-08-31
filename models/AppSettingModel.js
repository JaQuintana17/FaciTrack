const pool = require('../configs/db');

const AppSettingModel = {

    /**
     * Every setting, keyed for the view: `settings.daily_sync_limit.value`.
     * Returns an empty object rather than throwing if the table has not been
     * migrated yet, so a page that only displays a setting still renders.
     */
    async getAll() {
        try {
            const [rows] = await pool.query(
                'SELECT setting_key, setting_value, updated_at FROM app_settings'
            );
            return rows.reduce((all, row) => {
                all[row.setting_key] = { value: row.setting_value, updatedAt: row.updated_at };
                return all;
            }, {});
        } catch (err) {
            console.warn('[AppSettingModel.getAll]', err.message);
            return {};
        }
    },

    async get(key, fallback = null) {
        const [rows] = await pool.execute(
            'SELECT setting_value FROM app_settings WHERE setting_key = ?', [key]
        );
        return rows.length ? rows[0].setting_value : fallback;
    },

    /** Upsert, recording who changed it — these are system-wide values. */
    async set(key, value, updatedByInternalId = null) {
        const [result] = await pool.execute(
            `INSERT INTO app_settings (setting_key, setting_value, updated_by)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE
                 setting_value = VALUES(setting_value),
                 updated_by    = VALUES(updated_by)`,
            [key, String(value), updatedByInternalId]
        );
        return result.affectedRows > 0;
    },
};

module.exports = AppSettingModel;
