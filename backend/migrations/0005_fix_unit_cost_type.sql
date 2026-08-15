-- 0005_fix_unit_cost_type.sql — unit_cost was created NUMERIC(14,2) but the
-- Rust model decodes f64 (FLOAT8); sqlx rejects NUMERIC→f64 ("mismatched
-- types"). Prototype tradeoff: double precision is fine for INR amounts at
-- this scale (display rounds to 2dp; revisit rust_decimal if sums need
-- banker's precision).
ALTER TABLE assets ALTER COLUMN unit_cost TYPE DOUBLE PRECISION;
