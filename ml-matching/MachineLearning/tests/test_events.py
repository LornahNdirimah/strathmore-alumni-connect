from matching_engine.events import JsonlEventLog, MatchEvent


def test_match_event_round_trip():
    event = MatchEvent(event_type="suggested", student_id="S1", alumnus_id="A1", metadata={"rank": 1})
    restored = MatchEvent.from_dict(event.to_dict())
    assert restored == event


def test_jsonl_event_log_append_and_read(tmp_path):
    path = tmp_path / "events.jsonl"
    log = JsonlEventLog(str(path))

    log.append(MatchEvent(event_type="suggested", student_id="S1", alumnus_id="A1"))
    log.append(MatchEvent(event_type="accepted", student_id="S1", alumnus_id="A1"))

    events = log.read_all()
    assert len(events) == 2
    assert [e.event_type for e in events] == ["suggested", "accepted"]


def test_jsonl_event_log_missing_file_returns_empty(tmp_path):
    log = JsonlEventLog(str(tmp_path / "does_not_exist.jsonl"))
    assert log.read_all() == []
