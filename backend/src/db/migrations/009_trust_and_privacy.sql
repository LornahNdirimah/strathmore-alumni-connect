-- migrate: foreign_keys=off
--
-- Trust and privacy (ROADMAP Phase 7): consent, account deletion, blocking,
-- reports, and invitations for bulk-imported alumni (DESIGN_BACKLOG #42, #44,
-- #46).

-- ---------------------------------------------------------------------------
-- Consent (DESIGN_BACKLOG #42, #44)
--
-- Which version of the privacy notice and code of conduct the person accepted,
-- and when. A new version asks everyone again. Accounts that existed before
-- this migration are recorded as having accepted the first version: they are
-- the seeded demo population, created before there was anything to accept.
-- ---------------------------------------------------------------------------

ALTER TABLE users ADD COLUMN terms_version TEXT;
ALTER TABLE users ADD COLUMN terms_accepted_at TEXT;
UPDATE users SET terms_version = '2026-09-30', terms_accepted_at = created_at;

-- ---------------------------------------------------------------------------
-- Account deletion (DESIGN_BACKLOG #44, ROADMAP decision D8)
--
-- Deleting an account anonymises it rather than removing the row: personal
-- details are erased, but the records other people depend on — mentorships,
-- sessions, feedback, the match log — keep their shape under "Former member".
-- ---------------------------------------------------------------------------

ALTER TABLE users ADD COLUMN deleted_at TEXT;

-- ---------------------------------------------------------------------------
-- Blocking and reports (DESIGN_BACKLOG #42)
-- ---------------------------------------------------------------------------

CREATE TABLE user_blocks (
  blocker_user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  blocked_user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at      TEXT NOT NULL,
  PRIMARY KEY (blocker_user_id, blocked_user_id),
  CHECK (blocker_user_id <> blocked_user_id)
);
CREATE INDEX idx_user_blocks_blocked ON user_blocks (blocked_user_id);

CREATE TABLE reports (
  id                TEXT PRIMARY KEY,
  reporter_user_id  TEXT REFERENCES users (id) ON DELETE SET NULL,
  reported_user_id  TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- Where it happened, so the reviewer can find it.
  context_type      TEXT NOT NULL CHECK (context_type IN ('message', 'profile', 'community', 'opportunity', 'other')),
  context_id        TEXT,
  reason            TEXT NOT NULL CHECK (reason IN ('harassment', 'spam', 'inappropriate', 'safety', 'impersonation', 'other')),
  details           TEXT,
  status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'actioned', 'dismissed')),
  resolution_note   TEXT,
  reviewed_by       TEXT REFERENCES users (id) ON DELETE SET NULL,
  reviewed_at       TEXT,
  created_at        TEXT NOT NULL
);
CREATE INDEX idx_reports_status ON reports (status, created_at);

-- ---------------------------------------------------------------------------
-- Invitations for bulk-imported alumni (DESIGN_BACKLOG #46)
--
-- An imported account has no password until its owner chooses one through an
-- emailed invitation link, a third token purpose. SQLite cannot widen a CHECK
-- in place, so email_tokens is rebuilt; nothing references it.
-- ---------------------------------------------------------------------------

CREATE TABLE email_tokens_new (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  purpose    TEXT NOT NULL CHECK (purpose IN ('verify-email', 'reset-password', 'invite')),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at    TEXT,
  created_at TEXT NOT NULL
);

INSERT INTO email_tokens_new (id, user_id, purpose, token_hash, expires_at, used_at, created_at)
SELECT id, user_id, purpose, token_hash, expires_at, used_at, created_at FROM email_tokens;

DROP TABLE email_tokens;
ALTER TABLE email_tokens_new RENAME TO email_tokens;
CREATE INDEX idx_email_tokens_user ON email_tokens (user_id, purpose);
