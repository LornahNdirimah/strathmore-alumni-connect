import json

import pandas as pd

from matching_engine.export import export_matches_to_json


def test_export_handles_mismatched_columns_without_nan_tokens(encoded, tmp_path):
    """Alumni and students have different opt-in columns (mentor_tracks vs
    target_track, etc.). Concatenating them (as run_demo.py does for the
    combined population passed to export) leaves NaN in whichever columns a
    given row's role doesn't have -- those must be dropped, not written out
    as a literal `NaN` token, which isn't valid JSON."""
    alumni_ids = encoded["alumni_df"]["person_id"].tolist()
    student_ids = encoded["students_df"]["person_id"].tolist()
    combined = pd.concat([encoded["alumni_df"], encoded["students_df"]], ignore_index=True)
    groups = {alumni_ids[0]: student_ids[:2]}

    out_path = tmp_path / "results.json"
    export_matches_to_json(groups, combined, str(out_path), id_to_vec=encoded["id_to_vec"])

    raw_text = out_path.read_text()
    assert "NaN" not in raw_text  # would be invalid JSON if present

    data = json.loads(raw_text)  # must be strictly parseable
    group_entry = data["groups"][0]
    assert group_entry["id"] == alumni_ids[0]
    # the alumnus profile should carry alumni-only fields, not student-only ones
    assert "mentor_tracks" in group_entry
    assert "target_track" not in group_entry
    # and vice versa for a matched student
    student_entry = group_entry["matched_students"][0]
    assert "target_track" in student_entry
    assert "mentor_tracks" not in student_entry
