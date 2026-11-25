-- 0027_email_ingest_body.sql — R2-BE-02 (issue #135): retain the full email
-- body on every email_ingest row. Previously only a 500-char audit excerpt
-- (and 120-char notify snippet) survived, so the verbatim source text of a
-- REQUEST_EMAIL_REPLY was unrecoverable. Nullable, no backfill: pre-existing
-- rows predate body capture and stay NULL.
ALTER TABLE email_ingest ADD COLUMN body TEXT;
