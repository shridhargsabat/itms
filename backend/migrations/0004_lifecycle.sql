-- 0004_lifecycle.sql — P0-4: warranty + purchase + cost fields, lifecycle events (issues #36 #37)

-- Cost + lifecycle fields on assets (unit cost in INR, straight-line depreciation
-- base date = purchase_date, expected EOL per Companies Act Schedule II ~3y).
ALTER TABLE assets
    ADD COLUMN unit_cost NUMERIC(14, 2),
    ADD COLUMN expected_eol DATE;

-- Lifecycle transition history: every status change records who/what/why.
CREATE TABLE asset_lifecycle_events (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    asset_id    UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    from_status VARCHAR(50),
    to_status   VARCHAR(50) NOT NULL,
    actor_id    UUID REFERENCES users(id) ON DELETE SET NULL,
    note        TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_lifecycle_events_asset ON asset_lifecycle_events (asset_id, created_at DESC);
