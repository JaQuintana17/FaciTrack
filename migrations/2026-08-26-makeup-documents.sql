-- ------------------------------------------------------------
-- Make-up requests: many documents per request
--
-- A request used to carry exactly one PDF in two columns on
-- makeup_requests. Instructors now attach several supporting PDFs plus
-- a separate polling sheet (PDF or spreadsheet), so the files move to
-- their own table and the old columns go away.
--
-- Safe to run once on an existing database; the backfill carries any
-- file already attached into the new table before the columns drop.
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS makeup_request_documents (
    id            CHAR(36) NOT NULL,
    request_id    CHAR(36) NOT NULL,
    kind          ENUM('support', 'polling') NOT NULL DEFAULT 'support',
    file_path     VARCHAR(255) NOT NULL,      -- stored outside public/
    original_name VARCHAR(255) NOT NULL,      -- what the instructor called it
    mime_type     VARCHAR(120) NOT NULL,
    size_bytes    INT UNSIGNED NOT NULL DEFAULT 0,
    uploaded_at   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    FOREIGN KEY (request_id) REFERENCES makeup_requests(id) ON DELETE CASCADE,
    INDEX idx_mrd_request (request_id, kind)
);

-- Carry over the single document each existing request already has
INSERT INTO makeup_request_documents
    (id, request_id, kind, file_path, original_name, mime_type, size_bytes)
SELECT UUID(), mr.id, 'support', mr.document_path, mr.document_original_name,
       'application/pdf', 0
  FROM makeup_requests mr
 WHERE mr.document_path IS NOT NULL AND mr.document_path <> ''
   AND NOT EXISTS (SELECT 1 FROM makeup_request_documents d WHERE d.request_id = mr.id);

ALTER TABLE makeup_requests
    DROP COLUMN document_path,
    DROP COLUMN document_original_name;

-- The dean's queue is first-come, first-served, and two requests filed in the
-- same second used to come back in an arbitrary order — so whoever won a
-- contested room changed between page loads. Millisecond precision keeps the
-- real filing order; the queries add an id tiebreak for the rest.
ALTER TABLE makeup_requests
    MODIFY submitted_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);
