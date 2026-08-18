-- Per-user theme preference (theme manager): light | dark | ledgerly | system
ALTER TABLE users ADD COLUMN theme VARCHAR(20) NOT NULL DEFAULT 'system';