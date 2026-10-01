import pytest

from matching_engine.assignment import capacitated_assignment


def test_capacity_never_exceeded(encoded):
    alumni_ids = encoded["alumni_df"]["person_id"].tolist()
    student_ids = encoded["students_df"]["person_id"].tolist()
    capacity = {aid: 1 for aid in alumni_ids}

    groups, total_score = capacitated_assignment(
        student_ids, encoded["student_vecs"], alumni_ids, encoded["alumni_vecs"], capacity
    )

    for aid, students in groups.items():
        assert len(students) <= capacity[aid]
    assert total_score >= 0


def test_no_duplicate_assignments(encoded):
    alumni_ids = encoded["alumni_df"]["person_id"].tolist()
    student_ids = encoded["students_df"]["person_id"].tolist()
    capacity = {aid: 3 for aid in alumni_ids}

    groups, _ = capacitated_assignment(
        student_ids, encoded["student_vecs"], alumni_ids, encoded["alumni_vecs"], capacity
    )
    all_assigned = [s for group in groups.values() for s in group]
    assert len(all_assigned) == len(set(all_assigned))


def test_zero_capacity_everyone_unassigned(encoded):
    alumni_ids = encoded["alumni_df"]["person_id"].tolist()
    student_ids = encoded["students_df"]["person_id"].tolist()
    capacity = {aid: 0 for aid in alumni_ids}

    groups, total_score = capacitated_assignment(
        student_ids, encoded["student_vecs"], alumni_ids, encoded["alumni_vecs"], capacity
    )
    assert all(len(students) == 0 for students in groups.values())
    assert total_score == 0.0


def test_raises_over_dense_cell_limit(encoded):
    alumni_ids = encoded["alumni_df"]["person_id"].tolist()
    student_ids = encoded["students_df"]["person_id"].tolist()
    # one mentor with an absurd capacity blows the dense-matrix safety guard
    capacity = {aid: 0 for aid in alumni_ids}
    capacity[alumni_ids[0]] = 5_000_000

    with pytest.raises(ValueError):
        capacitated_assignment(
            student_ids[:1], encoded["student_vecs"][:1], alumni_ids, encoded["alumni_vecs"], capacity
        )
