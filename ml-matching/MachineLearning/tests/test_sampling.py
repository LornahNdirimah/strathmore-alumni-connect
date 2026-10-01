from matching_engine.sampling import sample_opt_in_population, train_live_split


def test_sample_sizes_capped_at_pool(alumni_students):
    alumni_df, students_df = alumni_students
    opted_alumni, opted_students = sample_opt_in_population(
        alumni_df, students_df, seed=1, alumni_n=1000, student_n=1000
    )
    # pool only has 4 alumni / 6 students -- n should be capped, not error
    assert len(opted_alumni) == len(alumni_df)
    assert len(opted_students) == len(students_df)


def test_sample_reproducible_given_seed(alumni_students):
    alumni_df, students_df = alumni_students
    a1, s1 = sample_opt_in_population(alumni_df, students_df, seed=7, alumni_n=2, student_n=3)
    a2, s2 = sample_opt_in_population(alumni_df, students_df, seed=7, alumni_n=2, student_n=3)
    assert list(a1["person_id"]) == list(a2["person_id"])
    assert list(s1["person_id"]) == list(s2["person_id"])


def test_train_live_split_no_overlap_and_full_coverage(alumni_students):
    alumni_df, _ = alumni_students
    train_df, live_df = train_live_split(alumni_df, live_frac=0.5, seed=3)
    train_ids = set(train_df["person_id"])
    live_ids = set(live_df["person_id"])
    assert train_ids.isdisjoint(live_ids)
    assert train_ids | live_ids == set(alumni_df["person_id"])


def test_train_live_split_reproducible(alumni_students):
    alumni_df, _ = alumni_students
    train1, live1 = train_live_split(alumni_df, live_frac=0.5, seed=9)
    train2, live2 = train_live_split(alumni_df, live_frac=0.5, seed=9)
    assert list(train1["person_id"]) == list(train2["person_id"])
    assert list(live1["person_id"]) == list(live2["person_id"])
