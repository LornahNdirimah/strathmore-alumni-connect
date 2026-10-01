import pytest

from matching_engine.feedback_schema import FeedbackForm


def _valid_kwargs(**overrides):
    kwargs = dict(
        match_id="M1",
        respondent_role="student",
        satisfaction_rating=4,
        would_match_again=True,
        sessions_held=3,
        relationship_status="ongoing",
        primary_goal_progress="some",
    )
    kwargs.update(overrides)
    return kwargs


def test_valid_form_round_trips():
    form = FeedbackForm(**_valid_kwargs())
    restored = FeedbackForm.from_dict(form.to_dict())
    assert restored == form


@pytest.mark.parametrize("rating", [0, 6, -1])
def test_invalid_satisfaction_rating_rejected(rating):
    with pytest.raises(ValueError):
        FeedbackForm(**_valid_kwargs(satisfaction_rating=rating))


def test_invalid_respondent_role_rejected():
    with pytest.raises(ValueError):
        FeedbackForm(**_valid_kwargs(respondent_role="admin"))


def test_invalid_relationship_status_rejected():
    with pytest.raises(ValueError):
        FeedbackForm(**_valid_kwargs(relationship_status="unknown"))


def test_negative_sessions_held_rejected():
    with pytest.raises(ValueError):
        FeedbackForm(**_valid_kwargs(sessions_held=-1))
