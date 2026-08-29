-- Seed the settings the admin System Settings page edits.
--
-- These were environment variables first, so the defaults here match .env.
-- INSERT IGNORE means re-running is safe and never overwrites a value an
-- administrator has already changed. Requires 2026-08-28-app-settings.sql.

INSERT IGNORE INTO app_settings (setting_key, setting_value) VALUES
    ('booking_lead_time_hours',   '4'),
    ('pending_nudge_every_hours', '6'),
    ('makeup_max_weeks_ahead',    '8'),
    ('makeup_day_start',          '07:00'),
    ('makeup_day_end',            '21:00'),
    ('email_enabled',             '0'),
    ('push_enabled',              '1');

-- The Consultation Room no longer shows a daily synchronous limit, and nothing
-- else reads it.
DELETE FROM app_settings WHERE setting_key = 'daily_sync_limit';
