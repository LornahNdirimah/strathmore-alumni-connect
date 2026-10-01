-- Initial schema for the Alumni Mentorship Platform.
--
-- Two deliberate corrections to the shapes the mock data used:
--
-- 1. ONE identity convention. mockDb keyed mentors by number (1..4), users by
--    string ('alumni-001') and group members by string, which forced
--    AlumniDashboardPage to join an alumnus to their mentor row by display-name
--    equality. Here every id is TEXT and every relationship is a real foreign
--    key, so two people sharing a name can no longer collide.
--
-- 2. Timestamps are ISO 8601 UTC strings, not display strings. mockDb stored
--    'October 15, 2026' / '10:32 AM' / 'Yesterday', none of which sort or
--    compare. Display formatting is the serializer's job, not the database's.

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('student', 'alumni', 'admin')),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending', 'suspended')),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

-- Email lookup is the login hot path and must be case-insensitive: 'A@b.com'
-- and 'a@b.com' are the same account, and a UNIQUE index on raw text would let
-- both exist.
CREATE UNIQUE INDEX idx_users_email_lower ON users (lower(email));
CREATE INDEX idx_users_role ON users (role);

-- ---------------------------------------------------------------------------
-- Opt-in records (DESIGN_BACKLOG #3)
--
-- Presence of a row here -- not the account's role -- is what grants access to
-- the mentorship system. An alumnus with no mentor_profiles row is a member of
-- the alumni network but is not a mentor and must not be matchable.
-- ---------------------------------------------------------------------------

CREATE TABLE mentor_profiles (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
  headline       TEXT NOT NULL,
  company        TEXT NOT NULL,
  industry       TEXT NOT NULL,
  location       TEXT NOT NULL,
  bio            TEXT,
  -- DESIGN_BACKLOG #2: self-reported, per mentor. Never a global constant.
  capacity       INTEGER NOT NULL DEFAULT 3 CHECK (capacity >= 0),
  availability   TEXT NOT NULL DEFAULT 'Available' CHECK (availability IN ('Available', 'Busy')),
  cadence        TEXT CHECK (cadence IN ('weekly', 'biweekly', 'as-needed')),
  format_pref    TEXT CHECK (format_pref IN ('virtual', 'in-person', 'either')),
  -- Links this mentor to their row in the ML engine's population, so the
  -- worker's person_id results can be mapped back to real records.
  ml_person_id   TEXT UNIQUE,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE INDEX idx_mentor_profiles_industry ON mentor_profiles (industry);
CREATE INDEX idx_mentor_profiles_availability ON mentor_profiles (availability);

CREATE TABLE mentor_tracks (
  mentor_profile_id TEXT NOT NULL REFERENCES mentor_profiles (id) ON DELETE CASCADE,
  track             TEXT NOT NULL,
  PRIMARY KEY (mentor_profile_id, track)
);
CREATE INDEX idx_mentor_tracks_track ON mentor_tracks (track);

CREATE TABLE mentor_skills (
  mentor_profile_id TEXT NOT NULL REFERENCES mentor_profiles (id) ON DELETE CASCADE,
  skill             TEXT NOT NULL,
  PRIMARY KEY (mentor_profile_id, skill)
);
CREATE INDEX idx_mentor_skills_skill ON mentor_skills (skill);

CREATE TABLE mentor_certifications (
  id                TEXT PRIMARY KEY,
  mentor_profile_id TEXT NOT NULL REFERENCES mentor_profiles (id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  position          INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE mentor_timeline (
  id                TEXT PRIMARY KEY,
  mentor_profile_id TEXT NOT NULL REFERENCES mentor_profiles (id) ON DELETE CASCADE,
  year              TEXT NOT NULL,
  title             TEXT NOT NULL,
  org               TEXT NOT NULL,
  description       TEXT,
  position          INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE mentor_opportunities (
  id                TEXT PRIMARY KEY,
  mentor_profile_id TEXT NOT NULL REFERENCES mentor_profiles (id) ON DELETE CASCADE,
  title             TEXT NOT NULL,
  type              TEXT NOT NULL CHECK (type IN ('Internship', 'Full-time', 'Volunteer')),
  location          TEXT,
  description       TEXT,
  posted_at         TEXT NOT NULL,
  closes_at         TEXT
);
CREATE INDEX idx_mentor_opportunities_owner ON mentor_opportunities (mentor_profile_id);

CREATE TABLE opportunity_applications (
  id             TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL REFERENCES mentor_opportunities (id) ON DELETE CASCADE,
  user_id        TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  message        TEXT,
  created_at     TEXT NOT NULL,
  UNIQUE (opportunity_id, user_id)
);

-- Student opt-in: the career-goals form (DESIGN_BACKLOG #3, #5).
CREATE TABLE mentorship_seekers (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
  major              TEXT NOT NULL,
  year               TEXT NOT NULL,
  target_track       TEXT NOT NULL,
  career_goal_text   TEXT NOT NULL,
  preferred_cadence  TEXT NOT NULL CHECK (preferred_cadence IN ('weekly', 'biweekly', 'as-needed')),
  format_preference  TEXT NOT NULL CHECK (format_preference IN ('virtual', 'in-person', 'either')),
  -- JSON array of requested support types; small fixed vocabulary, not worth a
  -- join table when nothing queries across it.
  requested_support  TEXT NOT NULL DEFAULT '[]',
  interests          TEXT NOT NULL DEFAULT '[]',
  skill_tags         TEXT NOT NULL DEFAULT '[]',
  hobbies            TEXT NOT NULL DEFAULT '[]',
  unique_quality     TEXT,
  country            TEXT,
  state_province     TEXT,
  ml_person_id       TEXT UNIQUE,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Mentorship lifecycle
-- ---------------------------------------------------------------------------

-- mockDb's respondToMentorshipRequest carried only two display-name strings and
-- no id, so the server could not tell which request was being answered. Here a
-- request is a first-class row with its own primary key.
CREATE TABLE mentorship_requests (
  id                TEXT PRIMARY KEY,
  student_user_id   TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  mentor_profile_id TEXT NOT NULL REFERENCES mentor_profiles (id) ON DELETE CASCADE,
  interest          TEXT NOT NULL,
  preferred_slot    TEXT NOT NULL,
  message           TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'accepted', 'declined', 'withdrawn')),
  response_notes    TEXT,
  created_at        TEXT NOT NULL,
  responded_at      TEXT
);

CREATE INDEX idx_requests_mentor_status ON mentorship_requests (mentor_profile_id, status);
CREATE INDEX idx_requests_student ON mentorship_requests (student_user_id, created_at);

-- One open request per student/mentor pair. Prevents a student spamming the
-- same mentor; re-requesting is only possible once the prior one is resolved.
CREATE UNIQUE INDEX idx_requests_unique_pending
  ON mentorship_requests (student_user_id, mentor_profile_id)
  WHERE status = 'pending';

CREATE TABLE mentorship_relationships (
  id                TEXT PRIMARY KEY,
  mentor_profile_id TEXT NOT NULL REFERENCES mentor_profiles (id) ON DELETE CASCADE,
  student_user_id   TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  source_request_id TEXT REFERENCES mentorship_requests (id) ON DELETE SET NULL,
  status            TEXT NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'completed', 'paused')),
  started_at        TEXT NOT NULL,
  ended_at          TEXT,
  UNIQUE (mentor_profile_id, student_user_id)
);

CREATE INDEX idx_relationships_student ON mentorship_relationships (student_user_id, status);
CREATE INDEX idx_relationships_mentor ON mentorship_relationships (mentor_profile_id, status);

CREATE TABLE sessions (
  id              TEXT PRIMARY KEY,
  relationship_id TEXT NOT NULL REFERENCES mentorship_relationships (id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  scheduled_at    TEXT NOT NULL,
  duration_min    INTEGER NOT NULL DEFAULT 30,
  status          TEXT NOT NULL DEFAULT 'upcoming'
                    CHECK (status IN ('upcoming', 'completed', 'cancelled')),
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_sessions_relationship ON sessions (relationship_id, scheduled_at);

-- ---------------------------------------------------------------------------
-- Match events (DESIGN_BACKLOG #4)
--
-- Mirrors matching_engine.events.MatchEvent so this table can be exported
-- straight into the Tier-2 training set later. Behavioural actions only --
-- opinions live in `feedback`.
-- ---------------------------------------------------------------------------

CREATE TABLE match_events (
  id                TEXT PRIMARY KEY,
  event_type        TEXT NOT NULL CHECK (event_type IN ('suggested', 'requested', 'accepted', 'declined')),
  student_user_id   TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  mentor_profile_id TEXT NOT NULL REFERENCES mentor_profiles (id) ON DELETE CASCADE,
  occurred_at       TEXT NOT NULL,
  metadata          TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX idx_match_events_student ON match_events (student_user_id, occurred_at);
CREATE INDEX idx_match_events_type ON match_events (event_type, occurred_at);

-- Post-match survey. Column-for-column with
-- matching_engine.feedback_schema.FeedbackForm (DESIGN_BACKLOG #5).
CREATE TABLE feedback (
  id                    TEXT PRIMARY KEY,
  relationship_id       TEXT NOT NULL REFERENCES mentorship_relationships (id) ON DELETE CASCADE,
  respondent_user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  respondent_role       TEXT NOT NULL CHECK (respondent_role IN ('student', 'alumni')),
  satisfaction_rating   INTEGER NOT NULL CHECK (satisfaction_rating BETWEEN 1 AND 5),
  would_match_again     INTEGER NOT NULL CHECK (would_match_again IN (0, 1)),
  sessions_held         INTEGER NOT NULL CHECK (sessions_held >= 0),
  relationship_status   TEXT NOT NULL CHECK (relationship_status IN ('ongoing', 'ended', 'never_started')),
  primary_goal_progress TEXT NOT NULL CHECK (primary_goal_progress IN ('none', 'some', 'significant')),
  free_text_comments    TEXT,
  submitted_at          TEXT NOT NULL,
  -- One response per person per relationship.
  UNIQUE (relationship_id, respondent_user_id)
);

-- ---------------------------------------------------------------------------
-- Communities (DESIGN_BACKLOG #1)
-- ---------------------------------------------------------------------------

CREATE TABLE groups (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  topic       TEXT NOT NULL,
  description TEXT NOT NULL,
  -- Defaults to alumni-only by decision: communities are an alumni peer space,
  -- and students being able to see them was an accident of a generic session
  -- gate. Only the creator may change this.
  visibility  TEXT NOT NULL DEFAULT 'alumni-only'
                CHECK (visibility IN ('alumni-only', 'open-to-students')),
  created_by  TEXT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX idx_groups_visibility ON groups (visibility);

CREATE TABLE group_members (
  group_id  TEXT NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  joined_at TEXT NOT NULL,
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX idx_group_members_user ON group_members (user_id);

CREATE TABLE group_resources (
  id       TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  title    TEXT NOT NULL,
  url      TEXT,
  position INTEGER NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------------
-- Messaging
--
-- mockDb stored `from: 'me' | 'them'` on the message record itself, which is a
-- rendering decision baked into storage -- the same row means different things
-- to different viewers. Here a message records its sender and the API decides
-- 'me'/'them' per requester. conversation_participants.last_read_at also makes
-- unread counts real; mockDb's unreadCount could never be decremented.
-- ---------------------------------------------------------------------------

CREATE TABLE conversations (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE conversation_participants (
  conversation_id TEXT NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  last_read_at    TEXT,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX idx_participants_user ON conversation_participants (user_id);

CREATE TABLE messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  sender_user_id  TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  body            TEXT NOT NULL,
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_messages_conversation ON messages (conversation_id, created_at);

-- ---------------------------------------------------------------------------
-- Events, announcements, verification
-- ---------------------------------------------------------------------------

CREATE TABLE events (
  id             TEXT PRIMARY KEY,
  title          TEXT NOT NULL,
  description    TEXT NOT NULL,
  -- ISO 8601 UTC. The human strings the UI shows ('October 15, 2026',
  -- '6:00 PM EAT') are derived at serialization time from this plus
  -- timezone_label, so events actually sort chronologically.
  starts_at      TEXT NOT NULL,
  ends_at        TEXT,
  timezone_label TEXT NOT NULL DEFAULT 'EAT',
  location       TEXT NOT NULL,
  type           TEXT NOT NULL CHECK (type IN ('In-Person', 'Online', 'Hybrid')),
  tag            TEXT NOT NULL,
  image_url      TEXT,
  created_at     TEXT NOT NULL
);
CREATE INDEX idx_events_starts_at ON events (starts_at);
CREATE INDEX idx_events_type ON events (type);

CREATE TABLE event_registrations (
  event_id   TEXT NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (event_id, user_id)
);

CREATE TABLE announcements (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  audience   TEXT NOT NULL CHECK (audience IN ('all', 'students', 'alumni')),
  created_by TEXT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_announcements_created ON announcements (created_at);

CREATE TABLE alumni_verifications (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  class_year  TEXT NOT NULL,
  program     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'review', 'rejected')),
  reviewed_by TEXT REFERENCES users (id) ON DELETE SET NULL,
  reviewed_at TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_verifications_status ON alumni_verifications (status);
