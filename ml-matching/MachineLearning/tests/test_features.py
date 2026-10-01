from scipy import sparse

from matching_engine.features import FeatureEncoder, Weights, compatibility_score


def test_transform_stays_sparse(encoded):
    assert sparse.issparse(encoded["alumni_vecs"])
    assert sparse.issparse(encoded["student_vecs"])


def test_transform_shape_matches_row_count(encoded):
    assert encoded["alumni_vecs"].shape[0] == len(encoded["alumni_df"])
    assert encoded["student_vecs"].shape[0] == len(encoded["students_df"])
    # both blocks were fit on the same combined vocabulary, so alumni and
    # student vectors must have the same width to be comparable
    assert encoded["alumni_vecs"].shape[1] == encoded["student_vecs"].shape[1]


def test_self_similarity_is_one(encoded):
    vec = encoded["alumni_vecs"][0]
    assert abs(compatibility_score(vec, vec) - 1.0) < 1e-9


def test_works_without_synthetic_columns(alumni_students):
    """The encoder must degrade gracefully against the raw schema (no
    target_track/career_goal_text/mentor_tracks) -- not every caller will
    have run the synthesis step."""
    import pandas as pd

    alumni_df, students_df = alumni_students
    combined = pd.concat([alumni_df, students_df], ignore_index=True)
    encoder = FeatureEncoder(Weights()).fit(combined)
    vecs = encoder.transform(alumni_df)
    assert vecs.shape[0] == len(alumni_df)
