-- migrate: foreign_keys=off
--
-- Mentorship lifecycle, alumni-owned opportunities, event management and the
-- admin audit log (ROADMAP Phase 3).
--
-- Two tables are rebuilt rather than altered, because SQLite cannot change a
-- CHECK constraint or a NOT NULL in place. The directive above makes the
-- migration runner switch foreign-key enforcement off around this file and run
-- `PRAGMA foreign_key_check` before committing (see db/migrate.ts).

-- ---------------------------------------------------------------------------
-- Requests can expire (DESIGN_BACKLOG #35)
--
-- An unanswered request used to stay pending for ever: the student waited on a
-- mentor who might never reply, and the mentor's inbox only grew. Requests now
-- expire after a fixed period, which needs its own status — reusing 'declined'
-- would claim the mentor said no when they said nothing.
-- ---------------------------------------------------------------------------

CREATE TABLE mentorship_requests_new (
  id                TEXT PRIMARY KEY,
  student_user_id   TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  mentor_profile_id TEXT NOT NULL REFERENCES mentor_profiles (id) ON DELETE CASCADE,
  interest          TEXT NOT NULL,
  preferred_slot    TEXT NOT NULL,
  preferred_slot_at TEXT,
  message           TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'accepted', 'declined', 'withdrawn', 'expired')),
  response_notes    TEXT,
  created_at        TEXT NOT NULL,
  responded_at      TEXT
);

INSERT INTO mentorship_requests_new
  (id, student_user_id, mentor_profile_id, interest, preferred_slot, preferred_slot_at,
   message, status, response_notes, created_at, responded_at)
SELECT id, student_user_id, mentor_profile_id, interest, preferred_slot, preferred_slot_at,
       message, status, response_notes, created_at, responded_at
FROM mentorship_requests;

DROP TABLE mentorship_requests;
ALTER TABLE mentorship_requests_new RENAME TO mentorship_requests;

CREATE INDEX idx_requests_mentor_status ON mentorship_requests (mentor_profile_id, status);
CREATE INDEX idx_requests_student ON mentorship_requests (student_user_id, created_at);
CREATE UNIQUE INDEX idx_requests_unique_pending
  ON mentorship_requests (student_user_id, mentor_profile_id)
  WHERE status = 'pending';
-- The expiry sweep looks for old pending requests.
CREATE INDEX idx_requests_pending_created ON mentorship_requests (created_at)
  WHERE status = 'pending';

-- ---------------------------------------------------------------------------
-- Opportunities belong to the alumnus, not to a mentor profile (ROADMAP D5)
--
-- Posting a job is something any verified alumnus may do; tying it to
-- mentor_profiles meant an alumnus had to become a mentor to share an opening.
-- The mentor link stays, nullable, so existing opportunities keep appearing on
-- their poster's mentor profile.
-- ---------------------------------------------------------------------------

CREATE TABLE mentor_opportunities_new (
  id                TEXT PRIMARY KEY,
  posted_by_user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  mentor_profile_id TEXT REFERENCES mentor_profiles (id) ON DELETE SET NULL,
  title             TEXT NOT NULL,
  type              TEXT NOT NULL CHECK (type IN ('Internship', 'Full-time', 'Volunteer')),
  location          TEXT,
  description       TEXT,
  posted_at         TEXT NOT NULL,
  closes_at         TEXT
);

INSERT INTO mentor_opportunities_new
  (id, posted_by_user_id, mentor_profile_id, title, type, location, description, posted_at, closes_at)
SELECT o.id, mp.user_id, o.mentor_profile_id, o.title, o.type, o.location, o.description,
       o.posted_at, o.closes_at
FROM mentor_opportunities o
JOIN mentor_profiles mp ON mp.id = o.mentor_profile_id;

DROP TABLE mentor_opportunities;
ALTER TABLE mentor_opportunities_new RENAME TO mentor_opportunities;

CREATE INDEX idx_mentor_opportunities_owner ON mentor_opportunities (mentor_profile_id);
CREATE INDEX idx_opportunities_poster ON mentor_opportunities (posted_by_user_id, posted_at);
CREATE INDEX idx_opportunities_posted ON mentor_opportunities (posted_at);

-- ---------------------------------------------------------------------------
-- Mentorships have a term and can end (DESIGN_BACKLOG #7, #34)
--
-- Capacity is derived from active relationships, so a relationship that can
-- never end is a seat that can never be freed. A mentorship now runs for a set
-- term, either side can end it early, and the term's end closes it.
-- ---------------------------------------------------------------------------

ALTER TABLE mentorship_relationships ADD COLUMN ends_on TEXT;
ALTER TABLE mentorship_relationships ADD COLUMN ended_by_user_id TEXT REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE mentorship_relationships ADD COLUMN end_reason TEXT;

-- Existing mentorships get the standard 12-week term from when they started.
UPDATE mentorship_relationships
SET ends_on = strftime('%Y-%m-%dT%H:%M:%fZ', started_at, '+84 days')
WHERE ends_on IS NULL;

CREATE INDEX idx_relationships_ends_on ON mentorship_relationships (ends_on)
  WHERE status = 'active';

-- The mid-point check-in: a short "how is it going?" from each side, halfway
-- through the term. One per person per mentorship.
CREATE TABLE relationship_checkins (
  id              TEXT PRIMARY KEY,
  relationship_id TEXT NOT NULL REFERENCES mentorship_relationships (id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  progress        TEXT NOT NULL CHECK (progress IN ('on-track', 'needs-attention')),
  note            TEXT,
  created_at      TEXT NOT NULL,
  UNIQUE (relationship_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Events are managed by admins (DESIGN_BACKLOG #23)
-- ---------------------------------------------------------------------------

ALTER TABLE events ADD COLUMN created_by TEXT REFERENCES users (id) ON DELETE SET NULL;
-- Cancelled rather than deleted, so people who registered can be told.
ALTER TABLE events ADD COLUMN cancelled_at TEXT;

-- ---------------------------------------------------------------------------
-- Admin audit log (DESIGN_BACKLOG #45)
--
-- Who approved, rejected, suspended, announced, scheduled or removed what, and
-- when. Written in the same transaction as the action it records.
-- ---------------------------------------------------------------------------

CREATE TABLE admin_audit (
  id            TEXT PRIMARY KEY,
  admin_user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  action        TEXT NOT NULL,
  target_type   TEXT NOT NULL,
  target_id     TEXT NOT NULL,
  summary       TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE INDEX idx_admin_audit_created ON admin_audit (created_at);
