-- Mentor availability and real session booking.
--
-- Until now a "session" could only come into being through POST
-- /mentorship/sessions, which no screen called, and the mentorship request
-- carried its preferred time as free text ('Wednesday 5:30 PM'). That string
-- cannot be compared, cannot be checked against when a mentor is actually free,
-- and cannot become a calendar entry. Two things were missing underneath: a
-- mentor had no way to say when they are available, and a booking had nothing
-- to validate itself against.

-- ---------------------------------------------------------------------------
-- Recurring weekly availability
--
-- Stored as a weekday plus minute offsets rather than concrete timestamps,
-- because availability is a repeating rule ("Tuesdays 17:00-19:00"), not a list
-- of dates. Concrete bookable slots are derived from these windows at read
-- time, minus whatever is already booked.
--
-- Times are minutes from UTC midnight, matching how the rest of the schema
-- stores time; mentor_profiles.timezone_label carries the label to display
-- them under, exactly as the events table already does.
-- ---------------------------------------------------------------------------

CREATE TABLE mentor_availability (
  id                TEXT PRIMARY KEY,
  mentor_profile_id TEXT NOT NULL REFERENCES mentor_profiles (id) ON DELETE CASCADE,
  -- 0 = Sunday through 6 = Saturday, matching JavaScript's getUTCDay().
  day_of_week       INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_minute      INTEGER NOT NULL CHECK (start_minute BETWEEN 0 AND 1439),
  end_minute        INTEGER NOT NULL CHECK (end_minute BETWEEN 1 AND 1440),
  created_at        TEXT NOT NULL,
  -- A window that ends before it starts would silently produce zero slots.
  CHECK (end_minute > start_minute),
  -- The same window twice would duplicate every slot it generates.
  UNIQUE (mentor_profile_id, day_of_week, start_minute, end_minute)
);

CREATE INDEX idx_mentor_availability_profile ON mentor_availability (mentor_profile_id, day_of_week);

-- The label these windows are presented under, e.g. 'EAT'. Mirrors
-- events.timezone_label rather than inventing a second convention.
ALTER TABLE mentor_profiles ADD COLUMN timezone_label TEXT NOT NULL DEFAULT 'EAT';

-- How long this mentor's sessions run. Slot generation steps through each
-- availability window in increments of this, so a mentor who only does hour
-- long sessions never has half-hour slots offered on their behalf.
ALTER TABLE mentor_profiles ADD COLUMN session_duration_min INTEGER NOT NULL DEFAULT 30
  CHECK (session_duration_min BETWEEN 15 AND 240);

-- ---------------------------------------------------------------------------
-- Requests carry a real requested time
--
-- preferred_slot stays as the human label so existing rows keep rendering, but
-- the machine-readable timestamp is what acceptance now turns into the first
-- session. Nullable because a request may legitimately be sent without picking
-- a time -- and because every row that existed before this migration has none.
-- ---------------------------------------------------------------------------

ALTER TABLE mentorship_requests ADD COLUMN preferred_slot_at TEXT;

-- ---------------------------------------------------------------------------
-- Sessions
--
-- Who booked it, so the UI can say who asked for the slot and so a cancellation
-- can be attributed. Existing rows predate booking and are left null.
-- ---------------------------------------------------------------------------

ALTER TABLE sessions ADD COLUMN booked_by_user_id TEXT REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE sessions ADD COLUMN notes TEXT;
ALTER TABLE sessions ADD COLUMN cancelled_reason TEXT;

-- The two participants, denormalised from mentorship_relationships.
--
-- This exists for the indexes below. Double-booking is the failure this table
-- must prevent, and the conflict is per *person*, not per mentorship: two
-- different students booking the same mentor at 5pm Tuesday are two different
-- relationship_ids, so a unique index keyed on relationship_id would not notice.
-- The columns are nullable only because rows created before this migration
-- cannot be reconstructed; everything written from here on sets them.
ALTER TABLE sessions ADD COLUMN mentor_profile_id TEXT REFERENCES mentor_profiles (id) ON DELETE CASCADE;
ALTER TABLE sessions ADD COLUMN student_user_id TEXT REFERENCES users (id) ON DELETE CASCADE;

-- A UNIQUE index is the only place the no-double-booking guarantee actually
-- holds. Two concurrent bookings can both pass an application-level "is this
-- slot free?" check and both then insert; only the database can refuse the
-- second. Cancelled sessions are excluded so a freed slot can be rebooked.
CREATE UNIQUE INDEX idx_sessions_mentor_slot
  ON sessions (mentor_profile_id, scheduled_at)
  WHERE status <> 'cancelled' AND mentor_profile_id IS NOT NULL;

CREATE UNIQUE INDEX idx_sessions_student_slot
  ON sessions (student_user_id, scheduled_at)
  WHERE status <> 'cancelled' AND student_user_id IS NOT NULL;

CREATE INDEX idx_sessions_mentor_upcoming ON sessions (mentor_profile_id, scheduled_at)
  WHERE status = 'upcoming';
