-- 0016_ticket_templates.sql — #46 named ticket templates
-- Standard intake patterns (new-hire setup, printer issue, access request…)
-- prefill type/priority/description so requesters give the right info first.
CREATE TABLE IF NOT EXISTS ticket_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    ticket_type TEXT NOT NULL DEFAULT 'INCIDENT',
    priority TEXT NOT NULL DEFAULT 'MEDIUM',
    description TEXT NOT NULL DEFAULT '',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by UUID REFERENCES users(id),
    updated_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
