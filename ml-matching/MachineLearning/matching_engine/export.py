"""Export final matches to JSON for manual review -- not meant for the app
to consume, just readable enough for a human to skim and sanity-check."""
from __future__ import annotations

import json

import pandas as pd

from .features import compatibility_score

REVIEW_FIELDS = [
    "Name",
    "Major",
    "Hobbies",
    "Country",
    "State/Province",
    "Unique Quality",
    "target_track",
    "career_goal_text",
    "mentor_tracks",
    "capacity",
]


def export_matches_to_json(
    groups: dict[str, list[str]],
    df: pd.DataFrame,
    path: str,
    id_to_vec: dict | None = None,
    unmatched_ids: list[str] | None = None,
    run_stats: dict | None = None,
) -> str:
    """Writes final matches to `path`, with readable profile fields per
    person (whichever of REVIEW_FIELDS are present -- works whether or not
    the synthetic opt-in fields exist on `df`) and, when `id_to_vec` is
    supplied, each match's compatibility score for eyeballing quality.
    """
    df_indexed = df.set_index("person_id")
    present_fields = [c for c in REVIEW_FIELDS if c in df_indexed.columns]

    def profile(pid: str) -> dict:
        if pid not in df_indexed.index:
            return {"id": pid}
        row = df_indexed.loc[pid]
        # Skip NaN fields (e.g. a student-only column on an alumnus's row,
        # or vice versa) rather than including them -- `json.dump` would
        # otherwise emit a literal `NaN` token, which standard JSON doesn't
        # support and a strict parser (e.g. JS `JSON.parse`) would reject.
        # List-valued cells (Hobbies, mentor_tracks, requested_support) are
        # always "present" when not NaN -- checked first so `pd.notna` (which
        # returns an array, not a scalar, for list-like input) is never
        # called on one.
        return {
            "id": pid,
            **{c: row[c] for c in present_fields if isinstance(row[c], list) or pd.notna(row[c])},
        }

    match_list = []
    for alumnus_id, student_ids in groups.items():
        entry = profile(alumnus_id)
        students = []
        for sid in student_ids:
            s = profile(sid)
            if id_to_vec and alumnus_id in id_to_vec and sid in id_to_vec:
                s["compatibility_score"] = round(compatibility_score(id_to_vec[alumnus_id], id_to_vec[sid]), 4)
            students.append(s)
        entry["group_size"] = len(students)
        entry["matched_students"] = students
        match_list.append(entry)

    output = {
        "run_stats": run_stats or {},
        "unmatched_students": [profile(sid) for sid in (unmatched_ids or [])],
        "groups": match_list,
    }

    with open(path, "w") as f:
        json.dump(output, f, indent=2, default=str)
    return path
