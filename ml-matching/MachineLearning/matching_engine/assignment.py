"""Batch capacitated assignment -- for cold-start sweeps only (e.g. the
initial cohort at pilot launch, or a periodic pass over students who still
have no live match), not the steady-state matching mechanism. Day to day,
matching is `ranking.recommend_for_student` -- a live, per-student query.

This replaces the old pipeline's three-stage stable-match -> MMR-diversify
-> repair-displaced sequence with a single optimization: maximize total
compatibility subject to capacity, solved once via the Hungarian algorithm.
There's no separate "stability" property being targeted -- see
IMPLEMENTATION_GUIDE.md for why that doesn't apply here. The technique
itself (duplicate each mentor into `capacity` seats, solve the resulting
assignment problem) is the same one the old pipeline used only as a
benchmark ceiling; here it's promoted to the actual solver, generalized
from a uniform capacity constant to each mentor's own capacity.
"""
from __future__ import annotations

import numpy as np
from scipy.optimize import linear_sum_assignment
from sklearn.metrics.pairwise import cosine_similarity

# Safety guard: a dense n_students x n_seats cost matrix at this many cells
# is still comfortably fast and memory-light (a few tens of MB); well past
# it, this stops being the right tool -- sample the population first
# (matching_engine.sampling) rather than calling this on a full-scale one.
MAX_DENSE_CELLS = 4_000_000


def capacitated_assignment(
    student_ids: list[str],
    student_vecs,
    alumni_ids: list[str],
    alumni_vecs,
    alumni_capacity: dict[str, int],
) -> tuple[dict[str, list[str]], float]:
    """Optimal one-shot assignment maximizing total compatibility, subject
    to each mentor's own capacity. Returns (groups, total_score).

    Raises ValueError instead of silently hanging/exhausting memory if the
    resulting dense cost matrix would be too large -- see MAX_DENSE_CELLS.
    """
    n_students = len(student_ids)
    # Check the seat count cheaply (an O(n_alumni) sum) before building the
    # actual seats list -- a pathological capacity value (a typo'd extra
    # zero or two) would otherwise let the list comprehension itself try to
    # allocate tens of millions of tuples before the guard ever runs.
    total_seats = sum(int(alumni_capacity.get(aid, 0)) for aid in alumni_ids)

    if n_students == 0 or total_seats == 0:
        return {aid: [] for aid in alumni_ids}, 0.0

    cell_count = n_students * total_seats
    if cell_count > MAX_DENSE_CELLS:
        raise ValueError(
            f"capacitated_assignment would build a {n_students}x{total_seats} "
            f"({cell_count:,}-cell) dense cost matrix, over the "
            f"{MAX_DENSE_CELLS:,}-cell safety limit. This only scales to a "
            "few thousand people per side -- sample the population first "
            "(matching_engine.sampling.sample_opt_in_population) rather "
            "than calling this directly on a full-scale population."
        )

    seats = [(aid, seat) for aid in alumni_ids for seat in range(int(alumni_capacity.get(aid, 0)))]
    alumni_idx = {aid: i for i, aid in enumerate(alumni_ids)}
    sim_full = cosine_similarity(student_vecs, alumni_vecs)  # small pool at this scale, dense is fine
    cost = np.empty((n_students, len(seats)))
    for j, (aid, _seat) in enumerate(seats):
        cost[:, j] = -sim_full[:, alumni_idx[aid]]  # negate: minimize == maximize

    row_ind, col_ind = linear_sum_assignment(cost)
    groups: dict[str, list[str]] = {aid: [] for aid in alumni_ids}
    total_score = 0.0
    for r, c in zip(row_ind, col_ind):
        aid, _seat = seats[c]
        groups[aid].append(student_ids[r])
        total_score += -cost[r, c]

    return groups, total_score
