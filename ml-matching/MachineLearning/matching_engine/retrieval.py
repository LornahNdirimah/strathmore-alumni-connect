"""Candidate retrieval: given a student, which mentors are worth ranking?

Two entry points for two different situations:
  - `MentorIndex`: built ONCE over a pool of mentor vectors, then queried
    many times -- the right shape for the live product (a student opens
    the app, we look up candidates on demand). Building the index once and
    reusing it is what makes repeated single-student queries cheap.
  - `build_candidate_lists`: a batch top-K pass over every student at once.
    Not needed by `matching_engine.assignment` at current pilot scale (a
    few hundred people per side is small enough for a direct dense
    pairwise comparison -- see assignment.py), but kept as a reusable
    utility for exploration/evaluation, and as the natural fallback if the
    live population ever grows past what a dense cost matrix can hold.
"""
from __future__ import annotations

from scipy import sparse
from sklearn.neighbors import NearestNeighbors


class MentorIndex:
    """A `NearestNeighbors` index over a fixed pool of mentor vectors, built
    once and queried on demand. Rebuild it (construct a new `MentorIndex`)
    whenever the underlying mentor pool changes meaningfully (e.g.
    periodically, or when capacity/opt-in status changes) rather than on
    every request.
    """

    def __init__(self, mentor_ids: list[str], mentor_vecs: sparse.spmatrix):
        if len(mentor_ids) != mentor_vecs.shape[0]:
            raise ValueError("mentor_ids and mentor_vecs must have the same length")
        self.mentor_ids = list(mentor_ids)
        self._nn = NearestNeighbors(metric="cosine")
        self._nn.fit(mentor_vecs)

    def query(self, vec: sparse.spmatrix, k: int = 30) -> list[tuple[str, float]]:
        """Returns up to `k` (mentor_id, similarity) pairs for one query
        vector (a 1-row sparse matrix), best match first."""
        k = min(k, len(self.mentor_ids))
        if k == 0:
            return []
        dist, idx = self._nn.kneighbors(vec, n_neighbors=k)
        ranked = [(self.mentor_ids[j], 1 - dist[0, pos]) for pos, j in enumerate(idx[0])]
        ranked.sort(key=lambda t: -t[1])
        return ranked


def build_candidate_lists(
    student_ids: list[str],
    student_vecs: sparse.spmatrix,
    alumni_ids: list[str],
    alumni_vecs: sparse.spmatrix,
    top_k: int = 30,
) -> tuple[dict[str, list[tuple[str, float]]], dict[str, dict[str, float]]]:
    """For every student at once, finds the top_k nearest mentors by cosine
    similarity (one batched `kneighbors` call, not a loop of single
    queries).

    Returns:
      student_candidates: {student_id: [(mentor_id, score), ...]} ranked
        best -> worst
      alumni_candidates: {mentor_id: {student_id: score, ...}} reverse
        index, used for e.g. MMR's near-miss pool
    """
    top_k = min(top_k, len(alumni_ids))
    index = MentorIndex(alumni_ids, alumni_vecs)
    dist, idx = index._nn.kneighbors(student_vecs, n_neighbors=top_k)

    student_candidates: dict[str, list[tuple[str, float]]] = {}
    alumni_candidates: dict[str, dict[str, float]] = {aid: {} for aid in alumni_ids}
    for i, sid in enumerate(student_ids):
        ranked = [(alumni_ids[j], 1 - dist[i, pos]) for pos, j in enumerate(idx[i])]
        ranked.sort(key=lambda t: -t[1])
        student_candidates[sid] = ranked
        for aid, score in ranked:
            alumni_candidates[aid][sid] = score

    return student_candidates, alumni_candidates
