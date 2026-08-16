-- 0013_sla_ack.sql — acknowledge pre-existing SLA breaches (P1-4 follow-up)
-- Tickets that were already overdue when SLA shipped were never going to be
-- actioned by an escalation notice — mark them acknowledged so the sweep
-- only fires for breaches that happen AFTER the feature went live.
UPDATE tickets
SET sla_escalated_at = NOW()
WHERE sla_escalated_at IS NULL
  AND sla_due_at IS NOT NULL
  AND sla_due_at < NOW()
  AND status IN ('OPEN', 'IN_PROGRESS');
