-- 0026_ticket_checks.sql — TBE-01/02: CHECK allowlists for the ticket enums.
-- Handlers validate the same sets pre-insert (422); these constraints are the
-- backstop so no code path (intake, seed, console) can persist garbage that
-- filters/charts silently drop.
--
-- Allowed ticket_type values = masters ticket_type (INCIDENT,
-- SERVICE_REQUEST, CHANGE) + the values the shipped New-Ticket form offers
-- (PROBLEM, ACCESS, OTHER). Legacy 'REQUEST' rows (pre-normalization writes)
-- are folded to SERVICE_REQUEST first — every read path already treats the
-- two as equivalent.

UPDATE tickets SET ticket_type = 'SERVICE_REQUEST' WHERE ticket_type = 'REQUEST';

-- Defensive backfills: pre-validation code paths (portal create, intake)
-- could persist arbitrary values. Fold any surviving garbage to safe
-- defaults so the constraints below apply cleanly on live databases; such
-- rows were already invisible to filters/charts (TBE-01/02).
UPDATE tickets SET priority = 'MEDIUM'
WHERE priority NOT IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT');
UPDATE tickets SET ticket_type = 'INCIDENT'
WHERE ticket_type NOT IN ('INCIDENT', 'SERVICE_REQUEST', 'CHANGE', 'PROBLEM', 'ACCESS', 'OTHER');

ALTER TABLE tickets
    ADD CONSTRAINT tickets_priority_check
    CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT'));

ALTER TABLE tickets
    ADD CONSTRAINT tickets_ticket_type_check
    CHECK (ticket_type IN ('INCIDENT', 'SERVICE_REQUEST', 'CHANGE', 'PROBLEM', 'ACCESS', 'OTHER'));

ALTER TABLE tickets
    ADD CONSTRAINT tickets_status_check
    CHECK (status IN ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'));
