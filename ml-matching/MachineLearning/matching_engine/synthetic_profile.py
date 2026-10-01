"""Synthetic stand-ins for the opt-in-form fields that don't exist yet.

No real student career-goals form or alumni mentor-join form has been built
(tracked in DESIGN_BACKLOG.md). Until it exists, this module generates
*plausible* values for the fields those forms would collect, derived from
each person's existing profile (Major, Unique Quality) rather than pure
noise, so the synthetic population resembles what real submissions would
plausibly look like. This is explicitly illustrative data for exercising
the pipeline -- it must never be presented as, or trained on as if it were,
real user input. Deterministic given a seed.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .constants import CADENCES, FORMATS, SUPPORT_OPTIONS, TRACKS

# Best-fit mapping of the 70 majors observed in student_profiles.json onto
# the 8 tracks. Necessarily approximate for majors with no clean match
# (humanities/arts/health-science majors mostly fall to "Research" as the
# broad academic/clinical catch-all) -- good enough as a synthesis seed,
# not meant to be authoritative career guidance.
MAJOR_TO_TRACK: dict[str, str] = {
    # Data Science
    "Mathematics": "Data Science",
    "Information Systems": "Data Science",
    # Software Engineering
    "Computer Science": "Software Engineering",
    "Computer Engineering": "Software Engineering",
    "Electrical Engineering": "Software Engineering",
    # Product Design
    "Architecture": "Product Design",
    "Fashion Design": "Product Design",
    "Graphic Communication": "Product Design",
    "Graphic Design": "Product Design",
    "Industrial Design": "Product Design",
    "Interior Design": "Product Design",
    # Finance
    "Accounting": "Finance",
    "Economics": "Finance",
    # Entrepreneurship
    "Business Administration": "Entrepreneurship",
    "Culinary Arts": "Entrepreneurship",
    "Hospitality Management": "Entrepreneurship",
    "Management": "Entrepreneurship",
    # Public Policy
    "Criminology": "Public Policy",
    "Early Childhood Education": "Public Policy",
    "Elementary Education": "Public Policy",
    "Environmental Science": "Public Policy",
    "International Relations": "Public Policy",
    "Political Science": "Public Policy",
    "Public Health": "Public Policy",
    "Social Work": "Public Policy",
    "Sociology": "Public Policy",
    # Marketing
    "Art Therapy": "Marketing",
    "Communication": "Marketing",
    "Dance": "Marketing",
    "Drama": "Marketing",
    "English Literature": "Marketing",
    "Film Studies": "Marketing",
    "Journalism": "Marketing",
    "Marketing": "Marketing",
    "Music": "Marketing",
    "Theater": "Marketing",
    # Research (broad STEM / humanities / clinical catch-all)
    "Aerospace Engineering": "Research",
    "Anthropology": "Research",
    "Archaeology": "Research",
    "Art History": "Research",
    "Biochemistry": "Research",
    "Biology": "Research",
    "Biomedical Engineering": "Research",
    "Botany": "Research",
    "Chemical Engineering": "Research",
    "Civil Engineering": "Research",
    "Classics": "Research",
    "Dentistry": "Research",
    "Earth Science": "Research",
    "Ecology": "Research",
    "Forensic Science": "Research",
    "Geography": "Research",
    "Geology": "Research",
    "Health Science": "Research",
    "History": "Research",
    "Kinesiology": "Research",
    "Linguistics": "Research",
    "Marine Biology": "Research",
    "Mechanical Engineering": "Research",
    "Meteorology": "Research",
    "Microbiology": "Research",
    "Molecular Biology": "Research",
    "Neuroscience": "Research",
    "Nuclear Engineering": "Research",
    "Nursing": "Research",
    "Nutrition Science": "Research",
    "Philosophy": "Research",
    "Physics": "Research",
    "Psychology": "Research",
    "Veterinary Science": "Research",
}


def map_major_to_track(major: str) -> str:
    """Looks up a major's best-fit track, defaulting to 'Research' for any
    major not in the table (keeps this forward-compatible with new majors
    appearing in future data without raising)."""
    return MAJOR_TO_TRACK.get(major, "Research")


def _sample_subset(rng: np.random.Generator, options: list[str], min_n=1, max_n=2) -> list[str]:
    size = int(rng.integers(min_n, max_n + 1))
    return sorted(rng.choice(options, size=size, replace=False).tolist())


_GOAL_TEMPLATES = [
    "Looking to grow into a {track} career, building on my {major} background and interest in {quality}.",
    "Exploring {track} as a career direction -- I'm studying {major} and drawn to {quality}.",
    "Hoping to find a mentor in {track} who can help me turn my {major} studies and interest in {quality} into a career.",
]


def synthesize_student_fields(df: pd.DataFrame, seed: int = 42, pivot_prob: float = 0.25) -> pd.DataFrame:
    """Adds the student career-goals-form fields to `df` (a copy; `df` itself
    is not mutated): `target_track`, `career_goal_text`, `preferred_cadence`,
    `format_preference`, `requested_support`, `consent`.

    `target_track` is mostly derived from `Major` via `MAJOR_TO_TRACK`, but
    with probability `pivot_prob` a different, uniformly-random track is
    used instead -- simulating the realistic minority of students who want
    to pivot away from their field of study rather than continue in it.
    """
    out = df.copy()
    rng = np.random.default_rng(seed)
    n = len(out)

    base_track = out["Major"].map(map_major_to_track)
    pivot_mask = rng.random(n) < pivot_prob
    random_track = rng.choice(TRACKS, size=n)
    out["target_track"] = np.where(pivot_mask, random_track, base_track)

    out["preferred_cadence"] = rng.choice(CADENCES, size=n)
    out["format_preference"] = rng.choice(FORMATS, size=n)
    out["requested_support"] = [_sample_subset(rng, SUPPORT_OPTIONS) for _ in range(n)]

    templates = rng.choice(_GOAL_TEMPLATES, size=n)
    out["career_goal_text"] = [
        templates[i].format(
            track=out["target_track"].iloc[i],
            major=out["Major"].iloc[i],
            quality=str(out["Unique Quality"].iloc[i]).lower(),
        )
        for i in range(n)
    ]

    out["consent"] = True
    return out


def synthesize_alumni_fields(
    df: pd.DataFrame,
    seed: int = 42,
    capacity_choices=(1, 2, 3, 4, 5),
    capacity_probs=(0.35, 0.30, 0.20, 0.10, 0.05),
    second_track_prob: float = 0.3,
) -> pd.DataFrame:
    """Adds the alumni mentor-join-form fields to `df` (a copy): `capacity`,
    `mentor_tracks`, `availability_cadence`, `format_preference`,
    `verified`, `consent`.

    `capacity` is deliberately NOT uniform -- it's drawn from a distribution
    weighted toward smaller numbers (most mentors take on a modest few,
    fewer take many), replacing the old pipeline's single hardcoded
    `capacity=9` for everyone. `mentor_tracks` is mostly the alumnus's own
    major-derived track, with a chance of a second track added (someone's
    current career often isn't identical to what they studied).
    """
    out = df.copy()
    rng = np.random.default_rng(seed)
    n = len(out)

    out["capacity"] = rng.choice(capacity_choices, size=n, p=capacity_probs)

    base_track = out["Major"].map(map_major_to_track)
    add_second = rng.random(n) < second_track_prob
    second_track = rng.choice(TRACKS, size=n)
    mentor_tracks = []
    for i in range(n):
        tracks = [base_track.iloc[i]]
        if add_second[i] and second_track[i] not in tracks:
            tracks.append(second_track[i])
        mentor_tracks.append(tracks)
    out["mentor_tracks"] = mentor_tracks

    out["availability_cadence"] = rng.choice(CADENCES, size=n)
    out["format_preference"] = rng.choice(FORMATS, size=n)
    # In reality this comes from the admin verification queue (already
    # built in the frontend); every synthetic mentor is treated as verified
    # since this is a test population, not a real moderation queue.
    out["verified"] = True
    out["consent"] = True
    return out
