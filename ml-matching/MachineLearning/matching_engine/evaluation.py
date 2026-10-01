"""Match-quality evaluation. Simplified successor to the old pipeline's
inline scoring code and `audit_blocking_pairs` -- stability auditing is
retired along with stable matching itself (there's no real elicited-
preference market whose "no blocking pair" property would mean anything
here); what's left is the part that's still meaningful: how good are the
matches, compared to the best possible?
"""
from __future__ import annotations

from .features import compatibility_score


def total_compatibility(groups: dict[str, list[str]], id_to_vec: dict) -> float:
    """Sum of cosine similarity across every (mentor, student) pair in
    `groups`. Comparable across different assignment strategies -- e.g. the
    `capacitated_assignment` ceiling vs. what a batch of live
    `recommend_for_student` calls actually produced -- since it's the same
    scoring function either way."""
    total = 0.0
    for alumnus_id, student_ids in groups.items():
        for sid in student_ids:
            total += compatibility_score(id_to_vec[alumnus_id], id_to_vec[sid])
    return total


def ceiling_ratio(observed_total: float, ceiling_total: float) -> float:
    """What fraction of the compatibility ceiling (e.g. from
    `capacitated_assignment` over the full live pool) a given result
    achieved. Returns 0.0 rather than raising on a zero ceiling (a
    degenerate/tiny input with no similarity at all) instead of letting a
    ZeroDivisionError surface."""
    if ceiling_total == 0:
        return 0.0
    return observed_total / ceiling_total
