-- Notifications, session reminders and meeting links (DESIGN_BACKLOG #26, #39, #40).

-- One row per person per thing worth telling them. `link` is an in-app path
-- ('/alumni/my-mentees'), so a notification takes the reader to where they can
-- act on it. Announcements are copied here per recipient too, so every
-- notification has the same per-person read state.
CREATE TABLE notifications (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT,
  link       TEXT,
  -- Groups repeat notifications about the same thing, e.g. one conversation:
  -- a new message updates the unread notification instead of stacking another.
  group_key  TEXT,
  created_at TEXT NOT NULL,
  read_at    TEXT
);

CREATE INDEX idx_notifications_user_created ON notifications (user_id, created_at);
CREATE INDEX idx_notifications_user_unread ON notifications (user_id)
  WHERE read_at IS NULL;

-- A meeting URL for virtual sessions, set by whoever books or edits it.
ALTER TABLE sessions ADD COLUMN meeting_link TEXT;

-- When the reminder for a session went out, so the sweep sends it once.
ALTER TABLE sessions ADD COLUMN reminder_sent_at TEXT;
