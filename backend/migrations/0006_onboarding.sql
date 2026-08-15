-- 0006_onboarding.sql — P0-1 onboarding/offboarding IT workflow (issue #50)
-- HR/admin raises a joiner/leaver event; prefilled checklist of IT tasks
-- (assign assets, revoke access, schedule return, data-wipe flag) is
-- audit-logged with overdue tracking. Kills the #1 ghost-asset source.

CREATE TABLE onboarding_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_type VARCHAR(20) NOT NULL CHECK (event_type IN ('ONBOARDING', 'OFFBOARDING')),
    person_name VARCHAR(255) NOT NULL,
    person_email VARCHAR(255) NOT NULL,
    start_date DATE,
    notes TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE onboarding_tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id UUID NOT NULL REFERENCES onboarding_events(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    category VARCHAR(20) NOT NULL DEFAULT 'OTHER'
        CHECK (category IN ('ASSET', 'LICENSE', 'ACCESS', 'RETURN', 'DATA_WIPE', 'OTHER')),
    due_date DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'DONE')),
    asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
    note TEXT,
    completed_by UUID REFERENCES users(id),
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_onboarding_events_type ON onboarding_events (event_type, status);
CREATE INDEX idx_onboarding_tasks_event ON onboarding_tasks (event_id);
CREATE INDEX idx_onboarding_tasks_due ON onboarding_tasks (status, due_date);
