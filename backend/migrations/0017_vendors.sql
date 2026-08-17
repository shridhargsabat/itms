-- 0017_vendors.sql — #39 vendor master + claim log (Phase 2 ITAM)
CREATE TABLE vendors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    contact_name TEXT,
    contact_email TEXT,
    contact_phone TEXT,
    support_link TEXT,
    amc_expiry DATE,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE vendor_claims (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
    asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
    ticket_id UUID REFERENCES tickets(id) ON DELETE SET NULL,
    issue TEXT NOT NULL,
    outcome TEXT,
    replacement BOOLEAN NOT NULL DEFAULT false,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE assets ADD COLUMN vendor_id UUID REFERENCES vendors(id) ON DELETE SET NULL;

CREATE INDEX idx_claims_vendor ON vendor_claims(vendor_id);
CREATE INDEX idx_claims_asset ON vendor_claims(asset_id);
CREATE INDEX idx_assets_vendor ON assets(vendor_id);
