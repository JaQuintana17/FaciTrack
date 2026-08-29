-- The room scanners themselves.
--
-- Until now a scanner left no durable trace: its id reached presence_logs only
-- when an assigned tag moved. That makes a quiet tag ambiguous — a flat battery
-- and a dead scanner look identical. One row per scanner, refreshed on every
-- report, tells the two apart.
--
-- Requires 2026-08-28-ble-presence.sql.

CREATE TABLE IF NOT EXISTS ble_scanners (
    id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    scanner_id        VARCHAR(60) NOT NULL,        -- SCANNER_ID in the firmware
    room_id           INT UNSIGNED NULL,           -- resolved from ROOM_CODE
    last_seen_at      DATETIME NULL,
    last_uptime_sec   INT UNSIGNED NULL,           -- resets to 0 on reboot, so a
                                                   -- falling value means it restarted
    last_beacon_count SMALLINT UNSIGNED NULL,      -- how many tags it heard last time
    last_ip           VARCHAR(45) NULL,
    report_count      INT UNSIGNED NOT NULL DEFAULT 0,
    first_seen_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_scanner (scanner_id),
    CONSTRAINT fk_scanner_room FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE SET NULL
);

-- How long a scanner may go quiet before the health page calls it offline.
-- The firmware reports every 10s, so a minute is several missed reports.
INSERT IGNORE INTO app_settings (setting_key, setting_value) VALUES
    ('presence_scanner_offline_after_sec', '60');
