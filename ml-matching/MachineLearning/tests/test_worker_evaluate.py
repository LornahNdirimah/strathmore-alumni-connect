"""The worker's `evaluate` method: real mentorships scored against the best
assignment for the same students (DESIGN_BACKLOG #50)."""
import pytest

from ml_bridge import worker


def _person(pid, major, hobby, country, track=None, quality="curious"):
    record = {"person_id": pid, "Major": major, "Hobbies": [hobby], "Unique Quality": quality,
              "Country": country, "State/Province": ""}
    if track:
        record["mentor_tracks"] = [track]
    return record


@pytest.fixture(autouse=True)
def index():
    worker.handle_build_index({"mentors": [
        _person("m1", "Computer Science", "chess", "Kenya", "Data Science"),
        _person("m2", "Finance", "running", "Uganda", "Finance"),
    ]})
    yield
    worker.handle_build_index({"mentors": []})


STUDENTS = [
    _person("s1", "Finance", "running", "Uganda"),
    _person("s2", "Computer Science", "chess", "Kenya"),
]


def test_best_possible_pairs_reach_the_ceiling():
    result = worker.handle_evaluate({"students": STUDENTS, "pairs": {"m1": ["s2"], "m2": ["s1"]},
                                     "capacity": {"m1": 1, "m2": 1}})
    assert result["pairs"] == 2
    assert result["ceilingRatio"] == pytest.approx(1.0)


def test_crossed_pairs_fall_short_and_declines_are_compared():
    result = worker.handle_evaluate({"students": STUDENTS, "pairs": {"m1": ["s1"], "m2": ["s2"]},
                                     "declined": [["m1", "s2"]], "capacity": {"m1": 1, "m2": 1}})
    assert result["ceilingRatio"] < 0.5
    assert result["meanDeclined"] > result["meanAccepted"]


def test_unknown_people_and_empty_input_are_ignored():
    result = worker.handle_evaluate({"students": [], "pairs": {"m1": ["nobody"]}, "capacity": {"ghost": 3}})
    assert result["pairs"] == 0
    assert result["ceilingRatio"] is None
