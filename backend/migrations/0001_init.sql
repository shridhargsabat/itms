-- ITMS initial schema (from spec) + query indexes
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- User Roles: ADMIN, AGENT, EMPLOYEE
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'EMPLOYEE',
    department VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Asset Status: IN_STOCK, ASSIGNED, MAINTENANCE, RETIRED
-- Asset Categories: LAPTOP, DESKTOP, SERVER, NETWORK_DEVICE, MONITOR, LICENSE
CREATE TABLE assets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    asset_tag VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(50) NOT NULL,
    serial_number VARCHAR(255) UNIQUE NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'IN_STOCK',
    assigned_to_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    specs JSONB NOT NULL DEFAULT '{}'::jsonb,
    purchase_date DATE,
    warranty_expiry DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ticket Types: INCIDENT, SERVICE_REQUEST, CHANGE
-- Priority: LOW, MEDIUM, HIGH, URGENT
-- Status: OPEN, IN_PROGRESS, RESOLVED, CLOSED
CREATE TABLE tickets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ticket_number VARCHAR(50) UNIQUE NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    ticket_type VARCHAR(50) NOT NULL DEFAULT 'INCIDENT',
    priority VARCHAR(50) NOT NULL DEFAULT 'MEDIUM',
    status VARCHAR(50) NOT NULL DEFAULT 'OPEN',
    requester_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    assignee_id UUID REFERENCES users(id) ON DELETE SET NULL,
    asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- CMDB Graph Relationships: RUNS_ON, CONNECTS_TO, DEPENDS_ON, HOSTED_IN
CREATE TABLE ci_relationships (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    parent_asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    child_asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    relationship_type VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_ci_pair UNIQUE(parent_asset_id, child_asset_id, relationship_type)
);

-- Immutable Audit Log
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    target_type VARCHAR(50) NOT NULL,
    target_id UUID NOT NULL,
    diff JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for the query patterns
CREATE INDEX idx_assets_status ON assets(status);
CREATE INDEX idx_assets_category ON assets(category);
CREATE INDEX idx_tickets_status ON tickets(status);
CREATE INDEX idx_tickets_priority ON tickets(priority);
CREATE INDEX idx_tickets_requester ON tickets(requester_id);
CREATE INDEX idx_tickets_assignee ON tickets(assignee_id);
CREATE INDEX idx_tickets_asset ON tickets(asset_id);
CREATE INDEX idx_ci_relationships_parent ON ci_relationships(parent_asset_id);
CREATE INDEX idx_ci_relationships_child ON ci_relationships(child_asset_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at DESC);
