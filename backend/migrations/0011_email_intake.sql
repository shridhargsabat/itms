-- 0011_email_intake.sql — P1-3 email-to-ticket intake (issue #44)
-- Dedupe by Message-ID; thread linkage via thread_key (References/In-Reply-To
-- root); replies become comments on the linked ticket (GLPI/Zammad pattern).

ALTER TABLE tickets ADD COLUMN source VARCHAR(20) NOT NULL DEFAULT 'PORTAL';

CREATE TABLE email_ingest (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    message_id VARCHAR(320) NOT NULL UNIQUE,
    thread_key VARCHAR(320),
    ticket_id UUID REFERENCES tickets(id) ON DELETE CASCADE,
    from_email VARCHAR(255) NOT NULL,
    from_name VARCHAR(120),
    subject VARCHAR(255) NOT NULL,
    kind VARCHAR(20) NOT NULL DEFAULT 'TICKET',  -- TICKET | REPLY | DUPLICATE
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_email_ingest_thread ON email_ingest (thread_key) WHERE thread_key IS NOT NULL;
CREATE INDEX idx_email_ingest_ticket ON email_ingest (ticket_id) WHERE ticket_id IS NOT NULL;
