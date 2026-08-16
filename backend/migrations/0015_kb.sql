-- 0015_kb.sql — P1-7 lite knowledge base (issue #48)
-- Articles linked to ticket types, canned responses for agents, and
-- source-ticket linkage for convert-resolved→article. Single KB owner is
-- enforced operationally via created_by/updated_by tracking (guardrail).
CREATE TABLE IF NOT EXISTS kb_articles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_type TEXT NOT NULL DEFAULT 'INCIDENT',
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    source_ticket_id UUID REFERENCES tickets(id) ON DELETE SET NULL,
    created_by UUID REFERENCES users(id),
    updated_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_kb_articles_type ON kb_articles(ticket_type);

CREATE TABLE IF NOT EXISTS canned_responses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
