"""Feature engineering: one weighted, sparse compatibility vector per person.

Rewritten from the original pipeline to stay `scipy.sparse` end-to-end
(TF-IDF and one-hot output are naturally sparse; the old version called
`.toarray()` immediately and threw that away for no benefit -- wasteful at
23k-record scale). `NearestNeighbors` and `cosine_similarity` both accept
sparse input directly, so nothing downstream needs to change.

Also adds a `track` block encoding `target_track` (students) / `mentor_tracks`
(alumni) from synthetic_profile.py -- the closest thing this dataset has to
an explicit stated preference, so it's treated as a first-class weighted
similarity dimension rather than left out entirely.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
from scipy import sparse
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from sklearn.preprocessing import OneHotEncoder, normalize

from .constants import TRACKS

_TRACK_INDEX = {t: i for i, t in enumerate(TRACKS)}


def _track_lists(df: pd.DataFrame) -> pd.Series:
    """Normalizes either `mentor_tracks` (list column) or `target_track`
    (single-value column) into a uniform Series of lists, so both roles can
    be encoded the same way. Rows with neither column, or missing values,
    get an empty list (contributes nothing to the track block, not an
    error)."""
    if "mentor_tracks" in df.columns:
        return df["mentor_tracks"].apply(lambda v: v if isinstance(v, list) else ([v] if pd.notna(v) else []))
    if "target_track" in df.columns:
        return df["target_track"].apply(lambda v: [v] if pd.notna(v) else [])
    return pd.Series([[] for _ in range(len(df))], index=df.index)


def _encode_tracks(df: pd.DataFrame) -> sparse.csr_matrix:
    """Multi-hot encoding over the fixed 8-track vocabulary. Not an sklearn
    transformer since the vocabulary is fixed and known ahead of time --
    nothing needs to be fit."""
    rows, cols, data = [], [], []
    for i, tracks in enumerate(_track_lists(df)):
        for t in tracks:
            j = _TRACK_INDEX.get(t)
            if j is not None:
                rows.append(i)
                cols.append(j)
                data.append(1.0)
    return sparse.csr_matrix((data, (rows, cols)), shape=(len(df), len(TRACKS)))


@dataclass
class Weights:
    major: float = 1.0
    hobbies: float = 1.0
    trait: float = 1.0
    location: float = 1.0
    track: float = 1.0


class FeatureEncoder:
    """Encodes Major, Hobbies, Unique Quality (+ career_goal_text when
    present), Country/State, and track preference into one concatenated,
    per-field-weighted sparse vector, such that cosine similarity on the
    concatenated vector approximates a weighted sum of the individual
    field similarities.

    NOTE ON TEXT ENCODING: TF-IDF (lexical overlap) by default so this runs
    fully offline. Swap `_trait_text`/`major_vec`/`hobby_vec` for a
    sentence-transformers model (e.g. 'all-MiniLM-L6-v2') for semantic
    matching if you have internet access -- see IMPLEMENTATION_GUIDE.md.
    """

    def __init__(self, weights: Weights = Weights()):
        self.weights = weights
        self.major_vec = TfidfVectorizer()
        self.hobby_vec = TfidfVectorizer()
        self.trait_vec = TfidfVectorizer()
        self.country_enc = OneHotEncoder(handle_unknown="ignore")
        self.state_enc = OneHotEncoder(handle_unknown="ignore")

    @staticmethod
    def _trait_text(df: pd.DataFrame) -> pd.Series:
        base = df["Unique Quality"].astype(str)
        if "career_goal_text" in df.columns:
            return base + " " + df["career_goal_text"].fillna("").astype(str)
        return base

    @staticmethod
    def _hobby_text(df: pd.DataFrame) -> pd.Series:
        return df["Hobbies"].apply(lambda h: " ".join(h))

    def fit(self, df: pd.DataFrame) -> "FeatureEncoder":
        self.major_vec.fit(df["Major"])
        self.hobby_vec.fit(self._hobby_text(df))
        self.trait_vec.fit(self._trait_text(df))
        self.country_enc.fit(df[["Country"]])
        self.state_enc.fit(df[["State/Province"]])
        return self

    def transform(self, df: pd.DataFrame) -> sparse.csr_matrix:
        w = self.weights
        major = normalize(self.major_vec.transform(df["Major"]))
        hobby = normalize(self.hobby_vec.transform(self._hobby_text(df)))
        trait = normalize(self.trait_vec.transform(self._trait_text(df)))
        country = normalize(self.country_enc.transform(df[["Country"]]))
        state = normalize(self.state_enc.transform(df[["State/Province"]]))
        # location = country match + state match, weighted 40/60 towards state
        location = normalize(sparse.hstack([country * 0.4, state * 0.6]))
        track = normalize(_encode_tracks(df))

        blocks = [
            np.sqrt(w.major) * major,
            np.sqrt(w.hobbies) * hobby,
            np.sqrt(w.trait) * trait,
            np.sqrt(w.location) * location,
            np.sqrt(w.track) * track,
        ]
        return sparse.hstack(blocks).tocsr()


def compatibility_score(vec_a: sparse.spmatrix, vec_b: sparse.spmatrix) -> float:
    """Cosine similarity between two people's combined feature vectors
    (each a 1-row sparse matrix, as returned by `.transform()` or a single
    row slice). Symmetric: score(a, b) == score(b, a)."""
    return float(cosine_similarity(vec_a, vec_b)[0, 0])
