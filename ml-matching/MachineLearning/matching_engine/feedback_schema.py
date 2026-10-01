"""The post-match feedback form schema.

This module ONLY defines and validates the shape of a real human response
-- it does not generate synthetic responses, simulate feedback, or train
anything. Tier 2 (a learned re-ranker) is explicitly gated on real
responses collected through a form built to this schema during an actual
pilot; see DESIGN_BACKLOG.md ("build the real ... post-match feedback
form"). Until that exists, this is a target to build the frontend form
against, not a source of training data.

Each field is chosen for what it would contribute to a future re-ranker,
not just "data that might be nice to have" -- see the comments below.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Literal, Optional

RespondentRole = Literal["student", "alumni"]
RelationshipStatus = Literal["ongoing", "ended", "never_started"]
GoalProgress = Literal["none", "some", "significant"]

_VALID_ROLES = {"student", "alumni"}
_VALID_STATUS = {"ongoing", "ended", "never_started"}
_VALID_PROGRESS = {"none", "some", "significant"}


@dataclass
class FeedbackForm:
    match_id: str
    respondent_role: RespondentRole

    # Explicit supervised-learning labels -- the clearest positive/negative
    # signal a re-ranker could eventually train on directly.
    satisfaction_rating: int  # 1 (poor) - 5 (excellent)
    would_match_again: bool

    # Implicit engagement signal -- often more reliable than a single
    # rating, and still present even if someone skips the rating question.
    sessions_held: int
    relationship_status: RelationshipStatus

    # Self-reported outcome, tying match quality back to the goal the
    # student stated at opt-in (synthesize_student_fields' career_goal_text
    # today; a real career-goals-form field later).
    primary_goal_progress: GoalProgress

    # Free text: not directly trainable without further NLP work, but
    # valuable for qualitative pilot review now and a candidate feature
    # source later (sentiment, topic extraction).
    free_text_comments: Optional[str] = None

    submitted_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def __post_init__(self):
        if self.respondent_role not in _VALID_ROLES:
            raise ValueError(f"respondent_role must be one of {_VALID_ROLES}, got {self.respondent_role!r}")
        if not (1 <= self.satisfaction_rating <= 5):
            raise ValueError(f"satisfaction_rating must be 1-5, got {self.satisfaction_rating!r}")
        if self.sessions_held < 0:
            raise ValueError(f"sessions_held must be >= 0, got {self.sessions_held!r}")
        if self.relationship_status not in _VALID_STATUS:
            raise ValueError(f"relationship_status must be one of {_VALID_STATUS}, got {self.relationship_status!r}")
        if self.primary_goal_progress not in _VALID_PROGRESS:
            raise ValueError(
                f"primary_goal_progress must be one of {_VALID_PROGRESS}, got {self.primary_goal_progress!r}"
            )

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "FeedbackForm":
        return cls(**d)
