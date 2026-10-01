"""Exports a sampled, synthesised pilot population as JSON for the backend seed.

Reuses the engine's own sampling and synthesis helpers rather than
reimplementing them, so the seeded population is drawn exactly the way
`run_demo.py` draws it — same seed, same distributions, same `person_id`s.
Those ids are carried into the database as `ml_person_id`, which is what lets
the worker's results be mapped back to real rows.

Usage:
    python3 -m ml_bridge.export_seed --alumni 300 --students 900 --seed 42
"""
from __future__ import annotations

import argparse
import json
import sys

from matching_engine import load_data, sample_opt_in_population, split_alumni_students
from matching_engine.synthetic_profile import (
    synthesize_alumni_fields,
    synthesize_student_fields,
)


def _records(df, columns: list[str]) -> list[dict]:
    """Serialises the columns the backend needs, coercing numpy scalars to
    native Python types so `json.dumps` can handle them."""
    out = []
    for _, row in df.iterrows():
        record = {}
        for column in columns:
            if column not in df.columns:
                continue
            value = row[column]
            if hasattr(value, "item"):
                value = value.item()
            elif isinstance(value, list):
                value = [str(item) for item in value]
            record[column] = value
        out.append(record)
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", default="student_profiles.json")
    parser.add_argument("--alumni", type=int, default=300)
    parser.add_argument("--students", type=int, default=900)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    df = load_data(args.data)
    alumni_pool, student_pool = split_alumni_students(df)

    opted_alumni, opted_students = sample_opt_in_population(
        alumni_pool, student_pool, seed=args.seed, alumni_n=args.alumni, student_n=args.students
    )

    opted_alumni = synthesize_alumni_fields(opted_alumni, seed=args.seed)
    opted_students = synthesize_student_fields(opted_students, seed=args.seed)

    shared = [
        "person_id", "Name", "Age", "Sex", "Major", "Year", "GPA", "Hobbies",
        "Country", "State/Province", "Unique Quality",
    ]

    payload = {
        "meta": {
            "seed": args.seed,
            "alumni": int(len(opted_alumni)),
            "students": int(len(opted_students)),
        },
        "alumni": _records(
            opted_alumni,
            shared + ["capacity", "mentor_tracks", "availability_cadence", "format_preference"],
        ),
        "students": _records(
            opted_students,
            shared
            + [
                "target_track", "career_goal_text", "preferred_cadence",
                "format_preference", "requested_support",
            ],
        ),
    }

    json.dump(payload, sys.stdout)
    sys.stdout.flush()


if __name__ == "__main__":
    main()
