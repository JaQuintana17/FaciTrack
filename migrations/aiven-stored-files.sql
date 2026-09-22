-- Stored-files tables for Aiven (MySQL 8).
--
-- The two dated migrations that build these (2026-09-21, 2026-09-22) are the
-- local MariaDB history: the second one ends with `DROP COLUMN IF EXISTS`, which
-- MariaDB accepts and MySQL does not. Aiven is fresh and has no rows to carry
-- forward, so it needs the final shape directly rather than the migration path.
--
-- Run this once against the Aiven database. Without it, uploading a profile
-- photo (or a make-up document) on Vercel fails, because on a serverless host
-- files are kept in these tables rather than on disk.

CREATE TABLE IF NOT EXISTS stored_files (
    file_key      VARCHAR(255) NOT NULL,
    kind          VARCHAR(32)  NOT NULL,           -- 'avatar' | 'makeup'
    mime_type     VARCHAR(120) NOT NULL DEFAULT 'application/octet-stream',
    original_name VARCHAR(255) NULL,
    byte_size     INT UNSIGNED NOT NULL DEFAULT 0,
    created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (file_key),
    INDEX idx_stored_files_kind (kind, created_at)
);

-- The bytes, split into 256 KB rows so no single statement approaches
-- max_allowed_packet. See services/file-store.js.
CREATE TABLE IF NOT EXISTS stored_file_chunks (
    file_key    VARCHAR(255) NOT NULL,
    chunk_index INT UNSIGNED NOT NULL,
    data        MEDIUMBLOB   NOT NULL,
    PRIMARY KEY (file_key, chunk_index),
    CONSTRAINT fk_chunk_file FOREIGN KEY (file_key)
        REFERENCES stored_files (file_key) ON DELETE CASCADE
);
