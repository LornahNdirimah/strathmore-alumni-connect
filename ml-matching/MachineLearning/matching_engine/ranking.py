"""Turning retrieved candidates into what's actually shown to a student.

`mmr_select` now diversifies the *options shown to one student* (a handful
of recommended mentors), not a mentor's whole assigned roster the way the
old pipeline's `diversify_groups` did -- a much more natural fit for a
browsing/recommendation UX, and it sidesteps the old "displaced student"
churn entirely, since nobody is being pulled out of an already-decided
group.
"""
from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd
from scipy import sparse
from sklearn.metrics.pairwise import cosine_similarity

from .retrieval import MentorIndex


def mmr_select(candidate_ids, candidate_vecs, relevance_scores, k, lam=0.6):
    """Greedy MMR: iteratively picks the candidate that maximizes
        lam * relevance - (1 - lam) * max_similarity_to_already_selected
    lam close to 1.0 -> prioritize compatibility; lam close to 0.0 ->
    prioritize spreading the options out. lam=1.0 reduces to plain top-k by
    relevance. `candidate_vecs` may be sparse or dense -- `cosine_similarity`
    handles either, and the output pairwise matrix is small regardless
    (candidate pools here are at most a few dozen).
    """
    n = len(candidate_ids)
    k = min(k, n)
    if k == 0:
        return []
    sim = cosine_similarity(candidate_vecs)
    selected, remaining = [], list(range(n))

    first = int(np.argmax(relevance_scores))
    selected.append(first)
    remaining.remove(first)

    while len(selected) < k and remaining:
        best_i, best_score = None, -np.inf
        for i in remaining:
            max_sim_to_selected = max(sim[i, j] for j in selected)
            mmr = lam * relevance_scores[i] - (1 - lam) * max_sim_to_selected
            if mmr > best_score:
                best_score, best_i = mmr, i
        selected.append(best_i)
        remaining.remove(best_i)

    return [candidate_ids[i] for i in selected]


def _matches_filters(row: pd.Series, filters: dict[str, Any]) -> bool:
    """A row matches if, for every filter key, either the row's value for
    that column equals the wanted value, or (for list-valued columns like
    `mentor_tracks`) the wanted value is a member of the list."""
    for key, want in filters.items():
        have = row.get(key)
        if isinstance(have, list):
            if want not in have:
                return False
        elif have != want:
            return False
    return True


def recommend_for_student(
    student_vec: sparse.spmatrix,
    mentor_index: MentorIndex,
    id_to_vec: dict[str, sparse.spmatrix],
    remaining_capacity: dict[str, int],
    mentor_df_indexed: pd.DataFrame | None = None,
    hard_filters: dict[str, Any] | None = None,
    top_k_candidates: int = 30,
    show_k: int = 5,
    lam: float = 0.6,
) -> list[str]:
    """The live, single-student entry point: returns up to `show_k`
    recommended mentor ids, ranked and diversified.

    - If `hard_filters` is given (e.g. {'target_track': 'Data Science'},
      matched against a mentor's `mentor_tracks` list; or
      {'format_preference': 'virtual'}), the eligible pool is narrowed by
      exact match BEFORE ranking -- `mentor_df_indexed` (a mentor DataFrame
      indexed by `person_id`) is required in this case, since filters
      apply to raw columns the vector-only `mentor_index` doesn't carry.
      At pilot scale a filtered pool is small enough that a direct
      similarity computation is simpler than building a throwaway index.
    - With no `hard_filters`, `mentor_index` (built once, shared across
      many queries) is used directly -- this is the case where a
      pre-built index actually pays for itself.

    Either way, mentors with no remaining capacity are dropped before
    ranking, and the final list is MMR-diversified down to `show_k` so a
    student doesn't just see 5 near-duplicate options.
    """
    if hard_filters:
        if mentor_df_indexed is None:
            raise ValueError("hard_filters given but mentor_df_indexed is None")
        eligible = [pid for pid, row in mentor_df_indexed.iterrows() if _matches_filters(row, hard_filters)]
        eligible = [pid for pid in eligible if remaining_capacity.get(pid, 0) > 0]
        if not eligible:
            return []
        eligible_vecs = sparse.vstack([id_to_vec[pid] for pid in eligible])
        sims = cosine_similarity(student_vec, eligible_vecs)[0]
        candidates = sorted(zip(eligible, sims), key=lambda t: -t[1])[:top_k_candidates]
    else:
        raw = mentor_index.query(student_vec, k=top_k_candidates)
        candidates = [(pid, score) for pid, score in raw if remaining_capacity.get(pid, 0) > 0]

    if not candidates:
        return []

    cand_ids = [pid for pid, _ in candidates]
    cand_scores = np.array([s for _, s in candidates])
    cand_vecs = sparse.vstack([id_to_vec[pid] for pid in cand_ids])
    return mmr_select(cand_ids, cand_vecs, cand_scores, k=show_k, lam=lam)
