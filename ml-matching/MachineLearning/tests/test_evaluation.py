from matching_engine.evaluation import ceiling_ratio, total_compatibility


def test_total_compatibility_sums_pairwise_scores(encoded):
    alumni_ids = encoded["alumni_df"]["person_id"].tolist()
    student_ids = encoded["students_df"]["person_id"].tolist()
    groups = {alumni_ids[0]: student_ids[:2]}

    total = total_compatibility(groups, encoded["id_to_vec"])
    assert total >= 0
    assert total <= 2.0 + 1e-9  # cosine similarity is bounded by 1 per pair


def test_total_compatibility_empty_groups(encoded):
    assert total_compatibility({}, encoded["id_to_vec"]) == 0.0


def test_ceiling_ratio_normal():
    assert abs(ceiling_ratio(5.0, 10.0) - 0.5) < 1e-9


def test_ceiling_ratio_zero_ceiling_does_not_raise():
    assert ceiling_ratio(3.0, 0.0) == 0.0
