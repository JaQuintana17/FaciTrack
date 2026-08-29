-- BLE presence: the tags, and the history of what they saw.
--
-- faculty_presence already exists and holds one CURRENT row per instructor.
-- This adds the two things it cannot do on its own: say which tag belongs to
-- whom, and remember what happened earlier.
--
-- Requires 2026-08-28-app-settings.sql (the tuning values are app_settings rows).

-- ------------------------------------------------------------
-- The physical tags
-- ------------------------------------------------------------
-- A tag is identified by its MAC, which is why the Minew E8 was the right
-- choice: phones rotate their BLE address every few minutes and cannot be
-- tracked this way. instructor_id is NULL until somebody assigns it, so a tag
-- that has never been seen before still gets recorded and shows up in Admin
-- waiting to be handed out.

CREATE TABLE IF NOT EXISTS ble_beacons (
    id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    mac_address    CHAR(17) NOT NULL,               -- 'aa:bb:cc:dd:ee:ff', lower case
    instructor_id  BIGINT NULL,
    label          VARCHAR(80) NULL,                -- what is written on the tag
    ibeacon_major  SMALLINT UNSIGNED NULL,          -- if configured as iBeacon
    ibeacon_minor  SMALLINT UNSIGNED NULL,
    battery_pct    TINYINT UNSIGNED NULL,
    is_active      TINYINT(1) NOT NULL DEFAULT 1,
    last_seen_at   DATETIME NULL,
    last_room_id   INT UNSIGNED NULL,
    last_rssi      SMALLINT NULL,
    created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_beacon_mac (mac_address),
    -- One tag per instructor: two tags on one person would fight over the room
    UNIQUE KEY uq_beacon_instructor (instructor_id),
    CONSTRAINT fk_beacon_instructor FOREIGN KEY (instructor_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_beacon_last_room  FOREIGN KEY (last_room_id)  REFERENCES rooms(id) ON DELETE SET NULL
);

-- ------------------------------------------------------------
-- Presence history
-- ------------------------------------------------------------
-- Append-only. faculty_presence answers "where are they now"; this answers
-- "where have they been", which is what the dean's reports page expects.

CREATE TABLE IF NOT EXISTS presence_logs (
    id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    instructor_id BIGINT NOT NULL,
    room_id       INT UNSIGNED NULL,
    event         ENUM('entered', 'exited', 'moved') NOT NULL,
    rssi          SMALLINT NULL,
    scanner_id    VARCHAR(60) NULL,
    occurred_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_plog_instructor FOREIGN KEY (instructor_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_plog_room       FOREIGN KEY (room_id)       REFERENCES rooms(id) ON DELETE SET NULL,
    INDEX idx_plog_instructor_time (instructor_id, occurred_at),
    INDEX idx_plog_time (occurred_at)
);

-- ------------------------------------------------------------
-- Tuning, editable in Admin → System Settings
-- ------------------------------------------------------------
-- The scanners report every beacon they hear and how strong it was; the server
-- decides what counts as "in the room". Keeping the rule here means retuning
-- never requires re-flashing a board.

INSERT IGNORE INTO app_settings (setting_key, setting_value) VALUES
    ('presence_rssi_threshold', '-75'),   -- stronger than this counts as in-room
    ('presence_absent_after_sec', '120'), -- unheard for this long, marked out
    ('presence_logging_enabled', '1');
