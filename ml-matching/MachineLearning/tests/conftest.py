"""Shared fixtures: a tiny (10-person) deterministic synthetic population,
small enough to reason about by hand, used across the test suite instead of
the real 23k-record dataset."""
import pandas as pd
import pytest

from matching_engine.data import split_alumni_students
from matching_engine.features import FeatureEncoder, Weights
from matching_engine.synthetic_profile import synthesize_alumni_fields, synthesize_student_fields

_RECORDS = [
    {"Name": "Alice Kim", "Age": 22, "Sex": "Female", "Major": "Computer Science", "Year": "Senior", "GPA": 3.7, "Hobbies": ["chess", "hiking"], "Country": "USA", "State/Province": "California", "Unique Quality": "Loves solving puzzles", "Story": "placeholder"},
    {"Name": "Ben Osei", "Age": 23, "Sex": "Male", "Major": "Accounting", "Year": "Senior", "GPA": 3.2, "Hobbies": ["running"], "Country": "Kenya", "State/Province": "Nairobi", "Unique Quality": "Detail-oriented planner", "Story": "placeholder"},
    {"Name": "Chloe Musa", "Age": 24, "Sex": "Female", "Major": "Graphic Design", "Year": "Senior", "GPA": 3.5, "Hobbies": ["painting", "photography"], "Country": "Nigeria", "State/Province": "Lagos", "Unique Quality": "Visual storyteller", "Story": "placeholder"},
    {"Name": "Dan Njoroge", "Age": 25, "Sex": "Male", "Major": "Political Science", "Year": "Senior", "GPA": 3.0, "Hobbies": ["debate"], "Country": "Kenya", "State/Province": "Mombasa", "Unique Quality": "Passionate advocate", "Story": "placeholder"},
    {"Name": "Ella Wang", "Age": 19, "Sex": "Female", "Major": "Computer Science", "Year": "Freshman", "GPA": 3.8, "Hobbies": ["chess", "coding"], "Country": "USA", "State/Province": "California", "Unique Quality": "Fast learner", "Story": "placeholder"},
    {"Name": "Femi Bello", "Age": 20, "Sex": "Male", "Major": "Business Administration", "Year": "Sophomore", "GPA": 3.1, "Hobbies": ["basketball"], "Country": "Nigeria", "State/Province": "Lagos", "Unique Quality": "Natural leader", "Story": "placeholder"},
    {"Name": "Grace Mwangi", "Age": 21, "Sex": "Female", "Major": "Graphic Design", "Year": "Junior", "GPA": 3.4, "Hobbies": ["painting"], "Country": "Kenya", "State/Province": "Nairobi", "Unique Quality": "Creative eye", "Story": "placeholder"},
    {"Name": "Henry Cole", "Age": 20, "Sex": "Male", "Major": "Political Science", "Year": "Sophomore", "GPA": 2.9, "Hobbies": ["debate", "reading"], "Country": "USA", "State/Province": "New York", "Unique Quality": "Sharp debater", "Story": "placeholder"},
    {"Name": "Ivy Chen", "Age": 22, "Sex": "Female", "Major": "Accounting", "Year": "Junior", "GPA": 3.6, "Hobbies": ["running", "yoga"], "Country": "USA", "State/Province": "New York", "Unique Quality": "Numbers-driven", "Story": "placeholder"},
    {"Name": "Jay Patel", "Age": 19, "Sex": "Male", "Major": "Mathematics", "Year": "Freshman", "GPA": 3.9, "Hobbies": ["chess"], "Country": "USA", "State/Province": "Texas", "Unique Quality": "Analytical thinker", "Story": "placeholder"},
]


@pytest.fixture
def raw_population() -> pd.DataFrame:
    df = pd.DataFrame(_RECORDS).reset_index(drop=True)
    df["person_id"] = df.index.map(lambda i: f"P{i}")
    return df


@pytest.fixture
def alumni_students(raw_population):
    return split_alumni_students(raw_population)


@pytest.fixture
def synthesized(alumni_students):
    alumni_df, students_df = alumni_students
    return (
        synthesize_alumni_fields(alumni_df, seed=1),
        synthesize_student_fields(students_df, seed=1),
    )


@pytest.fixture
def encoded(synthesized):
    """Fitted encoder + transformed vectors + an id->vec lookup, the shape
    most retrieval/ranking/assignment tests need."""
    alumni_df, students_df = synthesized

    encoder = FeatureEncoder(Weights()).fit(pd.concat([alumni_df, students_df], ignore_index=True))
    alumni_vecs = encoder.transform(alumni_df)
    student_vecs = encoder.transform(students_df)

    id_to_vec = {}
    for i, pid in enumerate(alumni_df["person_id"]):
        id_to_vec[pid] = alumni_vecs[i]
    for i, pid in enumerate(students_df["person_id"]):
        id_to_vec[pid] = student_vecs[i]

    return {
        "alumni_df": alumni_df,
        "students_df": students_df,
        "alumni_vecs": alumni_vecs,
        "student_vecs": student_vecs,
        "id_to_vec": id_to_vec,
        "encoder": encoder,
    }
