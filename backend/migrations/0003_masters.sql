-- Masters: lookup options (departments + enum-ish lists) + user soft-disable.
-- One table, one row per option; `family` groups them:
--   department | asset_category | ticket_type | ticket_priority | ticket_status
CREATE TABLE lookup_options (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    family VARCHAR(50) NOT NULL,
    code VARCHAR(50) NOT NULL,
    label VARCHAR(100) NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (family, code)
);

-- Soft-disable users instead of deleting (keeps audit/assignee history intact).
ALTER TABLE users ADD COLUMN active BOOLEAN NOT NULL DEFAULT TRUE;

INSERT INTO lookup_options (family, code, label, sort_order) VALUES
  ('department', 'IT', 'IT', 1),
  ('department', 'HR', 'HR', 2),
  ('department', 'FINANCE', 'Finance', 3),
  ('department', 'OPERATIONS', 'Operations', 4),
  ('department', 'DESIGN', 'Design', 5),
  ('department', 'MANAGEMENT', 'Management', 6),
  ('asset_category', 'LAPTOP', 'Laptop', 1),
  ('asset_category', 'DESKTOP', 'Desktop', 2),
  ('asset_category', 'SERVER', 'Server', 3),
  ('asset_category', 'NETWORK_DEVICE', 'Network Device', 4),
  ('asset_category', 'MONITOR', 'Monitor', 5),
  ('asset_category', 'LICENSE', 'License', 6),
  ('ticket_type', 'INCIDENT', 'Incident', 1),
  ('ticket_type', 'SERVICE_REQUEST', 'Service Request', 2),
  ('ticket_type', 'CHANGE', 'Change', 3),
  ('ticket_priority', 'LOW', 'Low', 1),
  ('ticket_priority', 'MEDIUM', 'Medium', 2),
  ('ticket_priority', 'HIGH', 'High', 3),
  ('ticket_priority', 'URGENT', 'Urgent', 4),
  ('ticket_status', 'OPEN', 'Open', 1),
  ('ticket_status', 'IN_PROGRESS', 'In Progress', 2),
  ('ticket_status', 'RESOLVED', 'Resolved', 3),
  ('ticket_status', 'CLOSED', 'Closed', 4);

CREATE INDEX idx_lookup_family ON lookup_options(family, sort_order);
