-- 0012_sla.sql — P1-4 SLA policy per priority + breach tracking (issue #45)
-- ONE fixed policy (URGENT 4h / HIGH 8h / MEDIUM 24h / LOW 72h), stored
-- deadline for fast overdue queries, single escalation notice per ticket.

ALTER TABLE tickets
    ADD COLUMN sla_due_at TIMESTAMPTZ,
    ADD COLUMN sla_escalated_at TIMESTAMPTZ;

-- Backfill OPEN/IN_PROGRESS tickets from creation time (closed tickets have no SLA)
UPDATE tickets
SET sla_due_at = created_at + INTERVAL '4 hours'
WHERE status IN ('OPEN', 'IN_PROGRESS') AND priority = 'URGENT';
UPDATE tickets
SET sla_due_at = created_at + INTERVAL '8 hours'
WHERE status IN ('OPEN', 'IN_PROGRESS') AND priority = 'HIGH';
UPDATE tickets
SET sla_due_at = created_at + INTERVAL '24 hours'
WHERE status IN ('OPEN', 'IN_PROGRESS') AND priority = 'MEDIUM';
UPDATE tickets
SET sla_due_at = created_at + INTERVAL '72 hours'
WHERE status IN ('OPEN', 'IN_PROGRESS') AND priority = 'LOW';

CREATE INDEX idx_tickets_sla_due ON tickets (sla_due_at) WHERE sla_due_at IS NOT NULL;
