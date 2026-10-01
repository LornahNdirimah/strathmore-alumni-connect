"""Behavioral match events -- suggested / accepted / declined. These are
mechanically loggable *actions* (recording that a click happened), not
opinions, so unlike feedback_schema.py's FeedbackForm this is safe to
generate and log directly rather than requiring a real human response.

This is the real interface a backend should implement: `MatchEvent` is the
schema, `JsonlEventLog` is a minimal reference implementation (a real
backend will likely use a database or event queue instead of a flat file,
but the shape is what matters for now).
"""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any, Literal

EventType = Literal["suggested", "accepted", "declined"]


@dataclass
class MatchEvent:
    event_type: EventType
    student_id: str
    alumnus_id: str
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "MatchEvent":
        return cls(**d)


class JsonlEventLog:
    """Append-only JSON-lines event log."""

    def __init__(self, path: str):
        self.path = path

    def append(self, event: MatchEvent) -> None:
        with open(self.path, "a") as f:
            f.write(json.dumps(event.to_dict()) + "\n")

    def read_all(self) -> list[MatchEvent]:
        try:
            with open(self.path) as f:
                return [MatchEvent.from_dict(json.loads(line)) for line in f if line.strip()]
        except FileNotFoundError:
            return []
