-- Mentorship quality (ROADMAP Phase 6): goals, per-session ratings and office
-- hours. The opportunities board and alumni directory need no schema.

-- ---------------------------------------------------------------------------
-- Goals per mentorship (DESIGN_BACKLOG #32)
--
-- What the pair agreed to work on, so "how much progress?" on the feedback form
-- has something concrete to be about. Either participant can add, tick off or
-- remove one.
-- ---------------------------------------------------------------------------

CREATE TABLE mentorship_goals (
  id              TEXT PRIMARY KEY,
  relationship_id TEXT NOT NULL REFERENCES mentorship_relationships (id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  created_by      TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL,
  completed_at    TEXT
);
CREATE INDEX idx_goals_relationship ON mentorship_goals (relationship_id, created_at);

-- ---------------------------------------------------------------------------
-- A rating after each held session (DESIGN_BACKLOG #33)
--
-- The end-of-mentorship form arrives months in; a one-tap rating per session
-- gives Tier-2 training data within weeks. Human-entered only, as with
-- `feedback`: one per person per session.
-- ---------------------------------------------------------------------------

CREATE TABLE session_ratings (
  session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  rating     INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment    TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (session_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Office hours (DESIGN_BACKLOG #36)
--
-- One mentor, several students, one time — a way to reach more students than
-- one-to-one capacity allows. Any student may join, not only the mentor's
-- mentees. An office hour counts as a commitment for the mentor and for each
-- student who joins, so neither can be double-booked against it.
-- ---------------------------------------------------------------------------

CREATE TABLE office_hours (
  id                TEXT PRIMARY KEY,
  mentor_profile_id TEXT NOT NULL REFERENCES mentor_profiles (id) ON DELETE CASCADE,
  title             TEXT NOT NULL,
  description       TEXT,
  starts_at         TEXT NOT NULL,
  duration_min      INTEGER NOT NULL CHECK (duration_min BETWEEN 15 AND 240),
  capacity          INTEGER NOT NULL CHECK (capacity BETWEEN 2 AND 50),
  meeting_link      TEXT,
  cancelled_at      TEXT,
  created_at        TEXT NOT NULL
);
CREATE INDEX idx_office_hours_upcoming ON office_hours (starts_at) WHERE cancelled_at IS NULL;
CREATE INDEX idx_office_hours_mentor ON office_hours (mentor_profile_id, starts_at);

CREATE TABLE office_hour_bookings (
  office_hour_id  TEXT NOT NULL REFERENCES office_hours (id) ON DELETE CASCADE,
  student_user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at      TEXT NOT NULL,
  PRIMARY KEY (office_hour_id, student_user_id)
);
CREATE INDEX idx_office_hour_bookings_student ON office_hour_bookings (student_user_id);
