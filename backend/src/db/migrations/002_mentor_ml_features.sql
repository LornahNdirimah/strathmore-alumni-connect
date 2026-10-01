-- The matching engine's FeatureEncoder reads Major, Hobbies, Unique Quality,
-- Country and State/Province. `mentorship_seekers` already carries those for
-- students; mentors had only the presentation fields (headline/company/
-- industry/location), so a mentor could be stored but never vectorised.
--
-- Added as a separate migration rather than edited into 001 because 001 has
-- already been applied — the runner treats a changed checksum on an applied
-- migration as schema drift and refuses to continue.

ALTER TABLE mentor_profiles ADD COLUMN major TEXT NOT NULL DEFAULT '';
ALTER TABLE mentor_profiles ADD COLUMN hobbies TEXT NOT NULL DEFAULT '[]';
ALTER TABLE mentor_profiles ADD COLUMN unique_quality TEXT NOT NULL DEFAULT '';
ALTER TABLE mentor_profiles ADD COLUMN country TEXT NOT NULL DEFAULT '';
ALTER TABLE mentor_profiles ADD COLUMN state_province TEXT NOT NULL DEFAULT '';

-- The engine's retrieval index is rebuilt from every mentor that has a
-- person id, so this is the hot lookup when the index is refreshed.
CREATE INDEX idx_mentor_profiles_ml_person ON mentor_profiles (ml_person_id);
