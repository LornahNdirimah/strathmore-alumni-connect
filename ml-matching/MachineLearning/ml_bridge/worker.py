"""Long-lived matching worker, driven over stdin/stdout.

Why a resident process rather than a script the API shells out to per request:
importing pandas/scikit-learn costs ~6.3s, while a warm `recommend_for_student`
call costs ~3.7ms. Paying the import once at boot and keeping the fitted encoder
and mentor index in memory is the difference between an unusable endpoint and
an instant one.

Protocol — newline-delimited JSON, one object per line:
    request  {"id": "1", "method": "recommend", "params": {...}}
    response {"id": "1", "ok": true, "result": {...}}
             {"id": "1", "ok": false, "error": {"message": "..."}}

This module is a thin adapter. It imports `matching_engine` and changes nothing
inside it, so the engine's own test suite remains the source of truth for
matching behaviour.
"""
from __future__ import annotations

import json
import sys
import traceback
from typing import Any

import pandas as pd

from matching_engine import FeatureEncoder, MentorIndex, Weights, recommend_for_student

# Columns FeatureEncoder expects. Mirrors the schema in matching_engine/data.py.
_REQUIRED_COLUMNS = ["Major", "Hobbies", "Unique Quality", "Country", "State/Province"]


class MatchingState:
    """Holds the fitted encoder and mentor index between requests."""

    def __init__(self) -> None:
        self.encoder: FeatureEncoder | None = None
        self.index: MentorIndex | None = None
        self.mentor_df: pd.DataFrame | None = None
        self.id_to_vec: dict[str, Any] = {}

    @property
    def ready(self) -> bool:
        return self.encoder is not None and self.index is not None


STATE = MatchingState()


def _to_dataframe(records: list[dict[str, Any]]) -> pd.DataFrame:
    """Builds a DataFrame with every column FeatureEncoder reads.

    Missing optional fields are filled rather than left absent: the encoder
    indexes columns directly, so an absent column raises where an empty value
    simply contributes nothing to the similarity.
    """
    df = pd.DataFrame(records)

    for column in _REQUIRED_COLUMNS:
        if column not in df.columns:
            df[column] = "" if column != "Hobbies" else [[] for _ in range(len(df))]

    df["Hobbies"] = df["Hobbies"].apply(lambda value: value if isinstance(value, list) else [])

    for column in _REQUIRED_COLUMNS:
        if column != "Hobbies":
            df[column] = df[column].fillna("").astype(str)

    if "person_id" not in df.columns:
        raise ValueError("every record must carry a person_id")

    return df


def handle_ping(_params: dict[str, Any]) -> dict[str, Any]:
    return {"pong": True, "ready": STATE.ready}


def handle_build_index(params: dict[str, Any]) -> dict[str, Any]:
    """Fits the encoder on the mentor corpus and builds the retrieval index.

    Called by the API at boot and again whenever the mentor pool changes
    materially. The encoder is fit on mentors only; a student's out-of-vocabulary
    terms simply contribute nothing, which is standard TF-IDF behaviour and
    keeps this a single-corpus fit rather than requiring every student upfront.
    """
    mentors = params.get("mentors") or []
    if not mentors:
        STATE.encoder, STATE.index, STATE.mentor_df, STATE.id_to_vec = None, None, None, {}
        return {"count": 0, "ready": False}

    mentor_df = _to_dataframe(mentors)

    weights = Weights(major=1.0, hobbies=1.0, trait=1.0, location=0.75, track=1.25)
    encoder = FeatureEncoder(weights).fit(mentor_df)
    vectors = encoder.transform(mentor_df)

    person_ids = mentor_df["person_id"].tolist()

    STATE.encoder = encoder
    STATE.index = MentorIndex(person_ids, vectors)
    STATE.mentor_df = mentor_df.set_index("person_id", drop=False)
    STATE.id_to_vec = {pid: vectors[i] for i, pid in enumerate(person_ids)}

    return {"count": len(person_ids), "ready": True}


def handle_recommend(params: dict[str, Any]) -> dict[str, Any]:
    """Ranks mentors for one student.

    `remaining_capacity` is supplied by the caller on every request rather than
    cached here: the database is the authority on how many seats a mentor has
    left, and a stale copy would hand out seats that no longer exist.
    """
    if not STATE.ready or STATE.encoder is None or STATE.index is None:
        raise RuntimeError("index has not been built yet")

    student = params.get("student")
    if not student:
        raise ValueError("student profile is required")

    student_df = _to_dataframe([{**student, "person_id": student.get("person_id", "query")}])
    student_vec = STATE.encoder.transform(student_df)[0]

    remaining_capacity = {
        str(key): int(value) for key, value in (params.get("remaining_capacity") or {}).items()
    }
    hard_filters = params.get("hard_filters") or None
    show_k = int(params.get("show_k", 5))
    top_k = int(params.get("top_k_candidates", 30))

    mentor_ids = recommend_for_student(
        student_vec,
        STATE.index,
        STATE.id_to_vec,
        remaining_capacity,
        mentor_df_indexed=STATE.mentor_df if hard_filters else None,
        hard_filters=hard_filters,
        top_k_candidates=top_k,
        show_k=show_k,
    )

    # Re-derive each pick's similarity so the API can show a match score
    # alongside the ranking rather than an opaque ordered list.
    from matching_engine import compatibility_score

    results = [
        {"person_id": pid, "score": round(compatibility_score(student_vec, STATE.id_to_vec[pid]), 4)}
        for pid in mentor_ids
        if pid in STATE.id_to_vec
    ]

    return {"mentors": results}


def handle_evaluate(params: dict[str, Any]) -> dict[str, Any]:
    """Scores real outcomes with the engine's own measures (DESIGN_BACKLOG #50).

    - `pairs`: mentorships that actually formed, as {mentor person_id: [student
      person_ids]}. Their total compatibility is compared with the best
      assignment `capacitated_assignment` finds for the same students and
      mentor capacities -- the ceiling `evaluation.ceiling_ratio` measures
      against.
    - `declined`: [[mentor, student], ...] requests a mentor turned down, so
      their mean compatibility can be set beside that of accepted pairs.

    Students are encoded with the mentor-fitted encoder, exactly as a live
    recommendation would encode them.
    """
    if not STATE.ready or STATE.encoder is None:
        raise RuntimeError("index has not been built yet")

    from matching_engine import capacitated_assignment, ceiling_ratio, compatibility_score, total_compatibility
    from scipy import sparse

    students = params.get("students") or []
    id_to_vec = dict(STATE.id_to_vec)
    if students:
        student_df = _to_dataframe(students)
        student_vecs = STATE.encoder.transform(student_df)
        for i, pid in enumerate(student_df["person_id"].tolist()):
            id_to_vec[pid] = student_vecs[i]

    def known(mentor: str, student: str) -> bool:
        return mentor in id_to_vec and student in id_to_vec

    pairs = {
        mentor: [s for s in group if known(mentor, s)]
        for mentor, group in (params.get("pairs") or {}).items()
    }
    pairs = {mentor: group for mentor, group in pairs.items() if group}
    declined = [(m, s) for m, s in (params.get("declined") or []) if known(m, s)]

    matched_students = sorted({s for group in pairs.values() for s in group})
    observed = total_compatibility(pairs, id_to_vec)
    pair_count = sum(len(group) for group in pairs.values())

    ceiling = None
    ceiling_note = None
    capacity = {str(k): int(v) for k, v in (params.get("capacity") or {}).items() if str(k) in STATE.id_to_vec}
    if matched_students and capacity:
        mentor_ids = list(capacity)
        try:
            _groups, ceiling = capacitated_assignment(
                matched_students,
                sparse.vstack([id_to_vec[s] for s in matched_students]),
                mentor_ids,
                sparse.vstack([id_to_vec[m] for m in mentor_ids]),
                capacity,
            )
        except ValueError as error:  # too large for the dense solver
            ceiling_note = str(error)

    def mean(values: list[float]) -> float | None:
        return round(sum(values) / len(values), 4) if values else None

    return {
        "pairs": pair_count,
        "observedTotal": round(observed, 4),
        "ceilingTotal": None if ceiling is None else round(ceiling, 4),
        "ceilingRatio": None if ceiling is None else round(ceiling_ratio(observed, ceiling), 4),
        "ceilingNote": ceiling_note,
        "meanAccepted": mean([compatibility_score(id_to_vec[m], id_to_vec[s]) for m, g in pairs.items() for s in g]),
        "meanDeclined": mean([compatibility_score(id_to_vec[m], id_to_vec[s]) for m, s in declined]),
        "declined": len(declined),
    }


HANDLERS = {
    "ping": handle_ping,
    "build_index": handle_build_index,
    "recommend": handle_recommend,
    "evaluate": handle_evaluate,
}


def _write(payload: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()


def main() -> None:
    # Announce readiness only after the heavy imports above have completed, so
    # the supervising process knows when the warmup cost has been paid.
    _write({"event": "ready"})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            request = json.loads(line)
        except json.JSONDecodeError:
            _write({"id": None, "ok": False, "error": {"message": "malformed JSON request"}})
            continue

        request_id = request.get("id")
        method = request.get("method")
        handler = HANDLERS.get(method)

        if handler is None:
            _write({"id": request_id, "ok": False, "error": {"message": f"unknown method: {method}"}})
            continue

        try:
            result = handler(request.get("params") or {})
            _write({"id": request_id, "ok": True, "result": result})
        except Exception as error:  # noqa: BLE001 - the worker must never die on one bad request
            print(traceback.format_exc(), file=sys.stderr, flush=True)
            _write({"id": request_id, "ok": False, "error": {"message": str(error)}})


if __name__ == "__main__":
    main()
