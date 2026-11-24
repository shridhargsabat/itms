-- Wave-2a: single-use SSO exchange codes.
-- The OAuth callback mints one code per completed Google flow (sha256 hash at
-- rest, 5-min TTL) and redirects the SPA with ONLY ?code=. The SPA redeems it
-- once via POST /auth/oauth/exchange (DELETE...RETURNING enforces single-use
-- + TTL atomically); the session token itself never appears in a URL.
CREATE TABLE oauth_codes (
  code_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX oauth_codes_expires_idx ON oauth_codes (expires_at);
