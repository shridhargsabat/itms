-- 0008_licenses.sql — P0-2 license/software seat tracking (issue #38)
-- Register (vendor, seats purchased, expiry, cost), per-seat assignment,
-- seats-vs-used utilization, 90/60/30-day expiry alerts.
-- Money columns are DOUBLE PRECISION (not NUMERIC — sqlx f64 can't decode
-- NUMERIC; see 0005 fix + P0-4 notes).

CREATE TABLE licenses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    vendor VARCHAR(255),
    license_type VARCHAR(20) NOT NULL DEFAULT 'SUBSCRIPTION'
        CHECK (license_type IN ('SUBSCRIPTION', 'PERPETUAL', 'OPEN_SOURCE')),
    seats_total INT NOT NULL DEFAULT 1 CHECK (seats_total >= 0),
    cost_per_seat DOUBLE PRECISION,
    cost_total DOUBLE PRECISION,
    currency VARCHAR(10) NOT NULL DEFAULT 'INR',
    expiry_date DATE,
    renewal_cost DOUBLE PRECISION,
    notes TEXT,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE license_allocations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    license_id UUID NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX uq_license_alloc_active
    ON license_allocations (license_id, user_id) WHERE revoked_at IS NULL;

CREATE INDEX idx_license_alloc_user ON license_allocations (user_id, revoked_at);
CREATE INDEX idx_licenses_expiry ON licenses (expiry_date);

-- Seed a small realistic register (common SME SaaS + tools; costs in INR/yr).
INSERT INTO licenses (name, vendor, license_type, seats_total, cost_per_seat, currency, expiry_date, notes) VALUES
('Microsoft 365 Business', 'Microsoft', 'SUBSCRIPTION', 25, 6120, 'INR', '2026-10-31', 'Email + Office apps'),
('Adobe Creative Cloud', 'Adobe', 'SUBSCRIPTION', 5, 28440, 'INR', '2026-09-15', 'Design team only'),
('Figma Professional', 'Figma', 'SUBSCRIPTION', 8, 18480, 'INR', '2026-08-31', 'Design + merch team'),
('AutoCAD LT', 'Autodesk', 'SUBSCRIPTION', 3, 54600, 'INR', '2026-11-20', 'Merchandising CAD'),
('Zoho One', 'Zoho', 'SUBSCRIPTION', 15, 14760, 'INR', '2026-12-31', 'Ops + admin'),
('Visual Studio Enterprise', 'Microsoft', 'SUBSCRIPTION', 2, 293040, 'INR', '2026-08-22', 'Dev machines'),
('VLC Media Player', 'Videolan', 'OPEN_SOURCE', 999, NULL, 'INR', NULL, 'Free — no cost'),
('Windows 11 Pro OEM', 'Microsoft', 'PERPETUAL', 12, 14500, 'INR', NULL, 'One-time licenses');
