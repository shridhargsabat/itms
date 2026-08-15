-- 0010_notifications.sql — P1-2 in-app notifications + outbound email queue (issue #43)
-- Notification center (bell + unread count + mark-read) and a pending_emails
-- queue drained by the external itms-mailer cron (SMTP-gated, allowlist).

CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind VARCHAR(60) NOT NULL,
    title VARCHAR(200) NOT NULL,
    body TEXT NOT NULL,
    ref_type VARCHAR(30),
    ref_id UUID,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_user ON notifications (user_id, created_at DESC);
CREATE INDEX idx_notifications_user_unread ON notifications (user_id) WHERE read_at IS NULL;

CREATE TABLE pending_emails (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    to_email VARCHAR(255) NOT NULL,
    to_name VARCHAR(120),
    subject VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    kind VARCHAR(60) NOT NULL,
    ref_type VARCHAR(30),
    ref_id UUID,
    attempts INT NOT NULL DEFAULT 0,
    last_error TEXT,
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pending_emails_unsent ON pending_emails (created_at) WHERE sent_at IS NULL;
