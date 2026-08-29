-- System-wide settings an administrator can change at runtime.
--
-- instructor_settings already exists but is scoped to one instructor; this is
-- the equivalent for values that apply to the whole system, kept as key/value
-- so a new setting does not need a migration of its own.

CREATE TABLE IF NOT EXISTS app_settings (
    setting_key   VARCHAR(60)  NOT NULL,
    setting_value VARCHAR(255) NOT NULL,
    updated_by    BIGINT NULL,
    updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (setting_key),
    CONSTRAINT fk_app_settings_user FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
);

-- The Consultation Room page reads this; INSERT IGNORE so re-running is safe.
INSERT IGNORE INTO app_settings (setting_key, setting_value) VALUES ('daily_sync_limit', '10');
