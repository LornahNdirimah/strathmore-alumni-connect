"""Retrieve-then-rank student-alumni matching engine.

See IMPLEMENTATION_GUIDE.md for the architecture and module map.
"""
from .assignment import capacitated_assignment
from .constants import CADENCES, FORMATS, SUPPORT_OPTIONS, TRACKS
from .data import load_data, split_alumni_students
from .evaluation import ceiling_ratio, total_compatibility
from .events import JsonlEventLog, MatchEvent
from .export import export_matches_to_json
from .feedback_schema import FeedbackForm
from .features import FeatureEncoder, Weights, compatibility_score
from .ranking import mmr_select, recommend_for_student
from .retrieval import MentorIndex, build_candidate_lists
from .sampling import sample_opt_in_population, train_live_split
from .synthetic_profile import (
    MAJOR_TO_TRACK,
    map_major_to_track,
    synthesize_alumni_fields,
    synthesize_student_fields,
)

__all__ = [
    "capacitated_assignment",
    "CADENCES",
    "FORMATS",
    "SUPPORT_OPTIONS",
    "TRACKS",
    "load_data",
    "split_alumni_students",
    "ceiling_ratio",
    "total_compatibility",
    "JsonlEventLog",
    "MatchEvent",
    "export_matches_to_json",
    "FeedbackForm",
    "FeatureEncoder",
    "Weights",
    "compatibility_score",
    "mmr_select",
    "recommend_for_student",
    "MentorIndex",
    "build_candidate_lists",
    "sample_opt_in_population",
    "train_live_split",
    "MAJOR_TO_TRACK",
    "map_major_to_track",
    "synthesize_alumni_fields",
    "synthesize_student_fields",
]
