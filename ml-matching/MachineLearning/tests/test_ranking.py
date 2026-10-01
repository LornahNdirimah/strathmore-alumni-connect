import numpy as np

from matching_engine.ranking import mmr_select, recommend_for_student
from matching_engine.retrieval import MentorIndex


def test_mmr_select_returns_k_unique(encoded):
    ids = encoded["alumni_df"]["person_id"].tolist()
    vecs = encoded["alumni_vecs"]
    scores = np.array([0.9, 0.5, 0.7, 0.3][: len(ids)])

    chosen = mmr_select(ids, vecs, scores, k=2)
    assert len(chosen) == 2
    assert len(set(chosen)) == 2
    assert all(c in ids for c in chosen)


def test_mmr_select_degrades_gracefully_when_k_exceeds_pool(encoded):
    ids = encoded["alumni_df"]["person_id"].tolist()
    vecs = encoded["alumni_vecs"]
    scores = np.ones(len(ids))
    chosen = mmr_select(ids, vecs, scores, k=1000)
    assert len(chosen) == len(ids)


def test_mmr_select_empty_pool_returns_empty():
    assert mmr_select([], None, np.array([]), k=3) == []


def test_recommend_for_student_respects_capacity(encoded):
    alumni_ids = encoded["alumni_df"]["person_id"].tolist()
    index = MentorIndex(alumni_ids, encoded["alumni_vecs"])
    remaining_capacity = {aid: 0 for aid in alumni_ids}  # nobody has room
    result = recommend_for_student(
        encoded["student_vecs"][0], index, encoded["id_to_vec"], remaining_capacity, show_k=3
    )
    assert result == []


def test_recommend_for_student_hard_filter_excludes_non_matching(encoded):
    alumni_ids = encoded["alumni_df"]["person_id"].tolist()
    index = MentorIndex(alumni_ids, encoded["alumni_vecs"])
    remaining_capacity = {aid: 5 for aid in alumni_ids}
    mentor_df_indexed = encoded["alumni_df"].set_index("person_id")

    # pick a track that only a subset of mentors have
    some_track = mentor_df_indexed["mentor_tracks"].iloc[0][0]
    eligible_ids = {
        pid for pid, row in mentor_df_indexed.iterrows() if some_track in row["mentor_tracks"]
    }

    result = recommend_for_student(
        encoded["student_vecs"][0],
        index,
        encoded["id_to_vec"],
        remaining_capacity,
        mentor_df_indexed=mentor_df_indexed,
        hard_filters={"mentor_tracks": some_track},
        show_k=10,
    )
    assert set(result).issubset(eligible_ids)


def test_recommend_for_student_hard_filter_requires_mentor_df(encoded):
    alumni_ids = encoded["alumni_df"]["person_id"].tolist()
    index = MentorIndex(alumni_ids, encoded["alumni_vecs"])
    remaining_capacity = {aid: 5 for aid in alumni_ids}
    try:
        recommend_for_student(
            encoded["student_vecs"][0],
            index,
            encoded["id_to_vec"],
            remaining_capacity,
            hard_filters={"format_preference": "virtual"},
        )
        assert False, "expected ValueError"
    except ValueError:
        pass
