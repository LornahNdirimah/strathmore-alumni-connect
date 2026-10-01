-- Account settings and profile photos (DESIGN_BACKLOG #24, #25).

-- Bumped when the password changes. Session tokens carry the version they were
-- issued at, and the auth guard refuses a token whose version is stale — so
-- changing a password signs out every other device, which is what someone who
-- suspects their password leaked needs it to do.
ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0;

-- The stored photo's file name (generated server-side, never user-supplied) and
-- when it last changed. The timestamp versions the photo's URL, so a new photo
-- is fetched rather than served from a stale browser cache.
ALTER TABLE users ADD COLUMN avatar_path TEXT;
ALTER TABLE users ADD COLUMN avatar_updated_at TEXT;
