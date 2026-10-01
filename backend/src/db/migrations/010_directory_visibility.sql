-- Profile visibility (DESIGN_BACKLOG #44, remainder). An alumnus can leave the
-- alumni directory without leaving mentoring: their mentor profile, when they
-- have one, stays discoverable to students through mentor search.
ALTER TABLE users ADD COLUMN directory_visible INTEGER NOT NULL DEFAULT 1
  CHECK (directory_visible IN (0, 1));
