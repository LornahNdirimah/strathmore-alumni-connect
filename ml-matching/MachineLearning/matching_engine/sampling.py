"""Simulating "who opted into the mentorship program" and splitting that
group into a train slice (for fitting/tuning) vs. a live slice (for
demonstrating the actual online recommend/assignment flow).

There is no real opt-in data yet -- no opt-in form has been built (tracked
in DESIGN_BACKLOG.md). Until it exists, a random sample of the full
population stands in for "the people who opted in". This is explicitly a
stand-in, not a claim about real user behavior -- see
synthetic_profile.py for the same caveat applied to the fields themselves.
"""
from __future__ import annotations

import pandas as pd
from sklearn.model_selection import train_test_split


def sample_opt_in_population(
    alumni_df: pd.DataFrame,
    students_df: pd.DataFrame,
    seed: int = 42,
    alumni_n: int = 300,
    student_n: int = 900,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Randomly samples `alumni_n` alumni and `student_n` students to stand in
    for the opted-in population.

    Defaults (~5% of each pool, preserving the observed ~1:3 alumni:student
    ratio) are a pilot-scale choice: large enough that capacity constraints,
    the assignment solver, and MMR diversification all have something
    meaningful to do, small enough to run fast and stay easy to eyeball.
    Tune via the arguments once you have a real target pilot size (e.g. a
    single school).

    `n` is capped at the pool size so this doesn't error out on a smaller
    dataset (e.g. the old 600-record mock).
    """
    alumni_n = min(alumni_n, len(alumni_df))
    student_n = min(student_n, len(students_df))

    opted_in_alumni = alumni_df.sample(n=alumni_n, random_state=seed).reset_index(drop=True)
    opted_in_students = students_df.sample(n=student_n, random_state=seed).reset_index(drop=True)
    return opted_in_alumni, opted_in_students


def train_live_split(
    df: pd.DataFrame, live_frac: float = 0.3, seed: int = 42
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Splits an opted-in pool into a train slice and a held-out live slice.

    `train`: used to fit/tune the feature encoder and (once real feedback
    exists) any learned component.
    `live`: held out to demonstrate the actual online recommend/assignment
    flow as if it were production traffic -- nobody in `live` was seen
    during fitting.

    Applied identically to the sampled alumni and the sampled students; the
    two calls are independent (an alumnus's train/live assignment has no
    bearing on which split a given student lands in).
    """
    train_df, live_df = train_test_split(df, test_size=live_frac, random_state=seed)
    return train_df.reset_index(drop=True), live_df.reset_index(drop=True)
