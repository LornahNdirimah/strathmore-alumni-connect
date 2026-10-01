-- Email verification and password reset (DESIGN_BACKLOG #43).

-- When the address was confirmed. Accounts that existed before this migration
-- are treated as verified from their creation: they were seeded or created
-- before there was any way to confirm, and asking all of them now would only
-- add friction to the demo accounts.
ALTER TABLE users ADD COLUMN email_verified_at TEXT;
UPDATE users SET email_verified_at = created_at WHERE email_verified_at IS NULL;

-- One-time links. Only a SHA-256 hash of each token is stored, so someone who
-- can read the database still cannot use a pending link.
CREATE TABLE email_tokens (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  purpose    TEXT NOT NULL CHECK (purpose IN ('verify-email', 'reset-password')),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at    TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_email_tokens_user ON email_tokens (user_id, purpose);
