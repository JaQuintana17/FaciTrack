-- ------------------------------------------------------------
-- External calendar sync (Google / Apple / any ICS feed)
--
-- Instructors subscribe FaciTrack to a calendar feed; the events land in
-- external_events and are drawn on the appointments calendar. An event may
-- also block the slot it covers, so students cannot book over it.
--
-- Times are stored the way the rest of the system stores them: a local
-- (Asia/Manila) date plus half-hour slot indices, matching workload_blocks
-- and makeup_request_schedules. An event crossing midnight is split into one
-- row per day so that model always holds.
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS calendar_connections (
    id             CHAR(36) NOT NULL,
    user_id        BIGINT NOT NULL,
    provider       ENUM('google', 'apple', 'other') NOT NULL DEFAULT 'other',
    display_name   VARCHAR(120) NOT NULL,
    feed_url       VARBINARY(1024) NOT NULL,   -- encrypted: the URL is a bearer secret
    feed_hint      VARCHAR(80) NOT NULL,       -- masked tail, safe to show back
    auto_sync      TINYINT(1) NOT NULL DEFAULT 1,
    blocking_rule  ENUM('always', 'never', 'ask') NOT NULL DEFAULT 'ask',
    import_titles  TINYINT(1) NOT NULL DEFAULT 1,   -- off = busy times only
    etag           VARCHAR(255) NULL,          -- conditional GET, so a poll is cheap
    last_modified  VARCHAR(255) NULL,
    last_synced_at DATETIME NULL,
    last_status    ENUM('never', 'ok', 'error') NOT NULL DEFAULT 'never',
    last_error     VARCHAR(300) NULL,
    event_count    INT UNSIGNED NOT NULL DEFAULT 0,
    created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_cc_user (user_id),
    INDEX idx_cc_due (auto_sync, last_synced_at)
);

CREATE TABLE IF NOT EXISTS external_events (
    id            BIGINT UNSIGNED AUTO_INCREMENT,
    connection_id CHAR(36) NOT NULL,
    user_id       BIGINT NOT NULL,
    uid           VARCHAR(255) NOT NULL,   -- the feed's own id, stable across syncs
    occurrence    VARCHAR(32)  NOT NULL,   -- which instance of a repeating event
    summary       VARCHAR(255) NULL,       -- NULL when the feed is busy-times-only
    location      VARCHAR(255) NULL,
    event_date    DATE NOT NULL,           -- Asia/Manila wall-clock
    start_slot    TINYINT UNSIGNED NULL,   -- NULL for an all-day event
    end_slot      TINYINT UNSIGNED NULL,
    all_day       TINYINT(1) NOT NULL DEFAULT 0,
    transparent   TINYINT(1) NOT NULL DEFAULT 0,   -- the feed marked it "free"
    blocks        TINYINT(1) NOT NULL DEFAULT 0,
    decision      ENUM('auto', 'pending', 'user') NOT NULL DEFAULT 'auto',
    -- Millisecond precision on purpose: the prune compares against the
    -- timestamp of the sync that just ran, and a second-precision column would
    -- truncate it and delete the rows that sync had only just written.
    last_seen_at  DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    FOREIGN KEY (connection_id) REFERENCES calendar_connections(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id)       REFERENCES users(id) ON DELETE CASCADE,
    -- One row per instance per day. Re-syncing upserts on this key rather than
    -- wiping the table, so a decision the instructor made is never lost.
    UNIQUE KEY uq_ee_instance (connection_id, uid, occurrence),
    INDEX idx_ee_when (user_id, event_date),
    INDEX idx_ee_blocking (user_id, blocks, event_date),
    INDEX idx_ee_pending (user_id, decision)
);
