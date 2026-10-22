-- Default theme: Liquid Glass Light for new users (#183).
-- Stored prefs (incl. 'system') are untouched; only the column default flips.
ALTER TABLE users ALTER COLUMN theme SET DEFAULT 'light';
