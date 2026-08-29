-- ============================================================
-- Outbound calendar feed
--
-- The other half of the calendar work: 2026-08-27-calendar-sync.sql brought
-- external events IN, this publishes FaciTrack's own schedule OUT as an ICS
-- feed that Google Calendar and Apple Calendar can subscribe to.
--
-- The token is what authenticates the request. Calendar clients cannot log in,
-- so the URL itself is the credential — which is why it lives in its own
-- column rather than being derived from public_id: a leaked feed can be
-- revoked for one person by regenerating their token, without breaking
-- everybody else's subscription.
-- ============================================================

ALTER TABLE users
    ADD COLUMN calendar_feed_token CHAR(43) NULL AFTER default_meeting_link,
    -- 32 random bytes, base64url. Unique so a collision cannot hand one
    -- person another person's schedule.
    ADD UNIQUE KEY idx_users_feed_token (calendar_feed_token);
