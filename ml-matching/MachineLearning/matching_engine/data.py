"""Load the raw population and split it into the alumni/student proxy pools.

Unchanged from the previous pipeline: `Year == "Senior"` is the proxy for
"alumni-eligible", everyone else is a student. This is still a proxy, not
real alumni status -- see IMPLEMENTATION_GUIDE.md.
"""
from __future__ import annotations

import json

import pandas as pd


def load_data(path: str) -> pd.DataFrame:
    """Loads either a .json (list of records) or .csv file into a DataFrame.
    Ensures 'Hobbies' is always a Python list (CSV often stores it as a
    comma/semicolon separated string)."""
    if path.endswith(".json"):
        with open(path) as f:
            records = json.load(f)
        df = pd.DataFrame(records)
    else:
        df = pd.read_csv(path)

    if df["Hobbies"].apply(lambda x: isinstance(x, str)).any():
        df["Hobbies"] = df["Hobbies"].apply(
            lambda x: [h.strip() for h in x.split(",")] if isinstance(x, str) else x
        )

    df = df.reset_index(drop=True)
    df["person_id"] = df.index.map(lambda i: f"P{i}")
    return df


def split_alumni_students(df: pd.DataFrame, alumni_years=("Senior",)):
    """Proxy split: Year == 'Senior' -> alumni-eligible pool, everyone else ->
    student pool. This is the full population, before any opt-in filtering --
    see matching_engine.sampling for turning this into the opted-in subset
    the mentorship program actually operates on."""
    alumni = df[df["Year"].isin(alumni_years)].reset_index(drop=True)
    students = df[~df["Year"].isin(alumni_years)].reset_index(drop=True)
    return alumni, students
