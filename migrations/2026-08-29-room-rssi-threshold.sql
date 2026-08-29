-- Per-room presence threshold.
--
-- One global cutoff is a compromise that fits no room exactly: a large
-- laboratory with the scanner at one end and a small consultation room need
-- different numbers. NULL keeps a room on the system-wide default, so nothing
-- has to be tuned until it actually needs tuning.
--
-- Requires 2026-08-28-ble-presence.sql (presence_rssi_threshold is the default).

ALTER TABLE rooms
    ADD COLUMN IF NOT EXISTS rssi_threshold SMALLINT NULL
    COMMENT 'dBm; NULL = use app_settings.presence_rssi_threshold'
    AFTER is_ble_scanner_installed;
