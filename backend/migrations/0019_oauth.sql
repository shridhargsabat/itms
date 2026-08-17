-- #53: admin-configurable Google SSO (OAuth 2.0, account linking).
CREATE TABLE oauth_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  provider text NOT NULL DEFAULT 'google',
  enabled boolean NOT NULL DEFAULT false,
  client_id text NOT NULL DEFAULT '',
  client_secret text NOT NULL DEFAULT '',
  allowed_domains text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Single config row (id=true); UPDATE-only from the admin API.
INSERT INTO oauth_config (id) VALUES (true);

-- One-time OAuth state nonces (consumed on callback, 10 min TTL).
CREATE TABLE oauth_states (
  state text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
