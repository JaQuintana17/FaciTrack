-- ============================================================
-- Instructor's own events and tasks
--
-- The third source of "things on my calendar", alongside consultations and
-- imported external events. This one is authored inside FaciTrack rather than
-- read from somewhere else, which is why it lives in its own table:
-- external_events is a cache the sync is free to prune, and anything written
-- there by hand would be wiped on the next fetch.
--
-- Deliberately mirrors external_events' shape (half-hour slot indices, an
-- all_day flag, a `blocks` flag) so the views can merge the two without a
-- translation layer.
-- ============================================================

CREATE TABLE IF NOT EXISTS instructor_events (
    id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    instructor_id BIGINT NOT NULL,
    kind          ENUM('event', 'task') NOT NULL DEFAULT 'event',
    title         VARCHAR(200) NOT NULL,
    notes         VARCHAR(500) NULL,
    event_date    DATE NOT NULL,
    -- Half-hour indices, as in workload_blocks and external_events:
    -- hour * 2 + (minute >= 30 ? 1 : 0). NULL on an all-day entry.
    start_slot    TINYINT UNSIGNED NULL,
    end_slot      TINYINT UNSIGNED NULL,
    all_day       TINYINT(1) NOT NULL DEFAULT 0,
    -- Whether students are barred from booking the hours it covers. A task is
    -- usually a personal reminder and does not block; an event usually does.
    blocks        TINYINT(1) NOT NULL DEFAULT 1,
    done          TINYINT(1) NOT NULL DEFAULT 0,   -- tasks only
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_inst_event_user FOREIGN KEY (instructor_id)
        REFERENCES users(id) ON DELETE CASCADE,
    -- The availability check filters by instructor and date on every slot query
    INDEX idx_inst_event_day (instructor_id, event_date),
    INDEX idx_inst_event_blocking (instructor_id, blocks, event_date)
);
