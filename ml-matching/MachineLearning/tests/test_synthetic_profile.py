from matching_engine.constants import CADENCES, FORMATS, SUPPORT_OPTIONS, TRACKS
from matching_engine.synthetic_profile import (
    map_major_to_track,
    synthesize_alumni_fields,
    synthesize_student_fields,
)


def test_map_major_to_track_known_and_fallback():
    assert map_major_to_track("Computer Science") == "Software Engineering"
    assert map_major_to_track("Marketing") == "Marketing"
    assert map_major_to_track("Some Major Not In The Table") == "Research"


def test_synthesize_student_fields(alumni_students):
    _, students_df = alumni_students
    out = synthesize_student_fields(students_df, seed=1)

    assert (out["target_track"].isin(TRACKS)).all()
    assert (out["preferred_cadence"].isin(CADENCES)).all()
    assert (out["format_preference"].isin(FORMATS)).all()
    assert out["consent"].all()
    assert (out["career_goal_text"].str.len() > 0).all()

    for support in out["requested_support"]:
        assert 1 <= len(support) <= 2
        assert all(s in SUPPORT_OPTIONS for s in support)
        assert len(support) == len(set(support))  # no duplicates within one person's picks

    # original df is not mutated
    assert "target_track" not in students_df.columns


def test_synthesize_alumni_fields(alumni_students):
    alumni_df, _ = alumni_students
    out = synthesize_alumni_fields(alumni_df, seed=1)

    assert out["capacity"].between(1, 5).all()
    assert out["verified"].all()
    assert out["consent"].all()
    assert (out["availability_cadence"].isin(CADENCES)).all()
    assert (out["format_preference"].isin(FORMATS)).all()

    for tracks in out["mentor_tracks"]:
        assert 1 <= len(tracks) <= 2
        assert all(t in TRACKS for t in tracks)


def test_synthesis_reproducible_given_seed(alumni_students):
    alumni_df, students_df = alumni_students
    a1 = synthesize_alumni_fields(alumni_df, seed=5)
    a2 = synthesize_alumni_fields(alumni_df, seed=5)
    assert a1["capacity"].tolist() == a2["capacity"].tolist()

    s1 = synthesize_student_fields(students_df, seed=5)
    s2 = synthesize_student_fields(students_df, seed=5)
    assert s1["target_track"].tolist() == s2["target_track"].tolist()
