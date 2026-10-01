from matching_engine.retrieval import MentorIndex, build_candidate_lists


def test_mentor_index_query_ranked_and_capped(encoded):
    alumni_ids = encoded["alumni_df"]["person_id"].tolist()
    index = MentorIndex(alumni_ids, encoded["alumni_vecs"])

    student_vec = encoded["student_vecs"][0]
    results = index.query(student_vec, k=2)

    assert len(results) == min(2, len(alumni_ids))
    scores = [score for _, score in results]
    assert scores == sorted(scores, reverse=True)
    assert all(aid in alumni_ids for aid, _ in results)


def test_mentor_index_query_k_larger_than_pool(encoded):
    alumni_ids = encoded["alumni_df"]["person_id"].tolist()
    index = MentorIndex(alumni_ids, encoded["alumni_vecs"])
    results = index.query(encoded["student_vecs"][0], k=1000)
    assert len(results) == len(alumni_ids)


def test_build_candidate_lists_reverse_index_consistent(encoded):
    student_ids = encoded["students_df"]["person_id"].tolist()
    alumni_ids = encoded["alumni_df"]["person_id"].tolist()

    student_candidates, alumni_candidates = build_candidate_lists(
        student_ids, encoded["student_vecs"], alumni_ids, encoded["alumni_vecs"], top_k=3
    )

    assert set(student_candidates.keys()) == set(student_ids)
    assert set(alumni_candidates.keys()) == set(alumni_ids)

    for sid, ranked in student_candidates.items():
        for aid, score in ranked:
            assert sid in alumni_candidates[aid]
            assert abs(alumni_candidates[aid][sid] - score) < 1e-9
