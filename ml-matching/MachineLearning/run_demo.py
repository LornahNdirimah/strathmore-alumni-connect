"""End-to-end demo of the retrieve-then-rank matching engine.

Walks through: load the full population -> classify alumni/students ->
sample the opted-in pilot population -> synthesize opt-in-form fields ->
train/live split -> fit features on train -> batch cold-start assignment
on live (the "ceiling") -> a live per-student greedy simulation (what the
actual product flow would produce) -> compare the two -> export -> a
MatchEvent logging demo -> one illustrative FeedbackForm example.

See IMPLEMENTATION_GUIDE.md for why the architecture looks like this, and
DESIGN_BACKLOG.md for what real opt-in/feedback forms would replace here.
"""
import pandas as pd

from matching_engine import (
    FeatureEncoder,
    JsonlEventLog,
    MatchEvent,
    MentorIndex,
    Weights,
    capacitated_assignment,
    ceiling_ratio,
    export_matches_to_json,
    load_data,
    recommend_for_student,
    sample_opt_in_population,
    split_alumni_students,
    total_compatibility,
    train_live_split,
)
from matching_engine.feedback_schema import FeedbackForm
from matching_engine.synthetic_profile import synthesize_alumni_fields, synthesize_student_fields

DATA_PATH = "student_profiles.json"
SEED = 42
ALUMNI_OPT_IN_N = 300
STUDENT_OPT_IN_N = 900
LIVE_FRAC = 0.3
OUTPUT_PATH = "match_results.json"
EVENT_LOG_PATH = "match_events.jsonl"

print("1. Loading full population...")
df = load_data(DATA_PATH)
alumni_pool, student_pool = split_alumni_students(df, alumni_years=("Senior",))
print(f"   {len(alumni_pool)} alumni-eligible (Year == Senior), {len(student_pool)} students, in the full population")

print("2. Sampling the opted-in pilot population (no real opt-in data exists yet -- random sample stands in)...")
opted_alumni, opted_students = sample_opt_in_population(
    alumni_pool, student_pool, seed=SEED, alumni_n=ALUMNI_OPT_IN_N, student_n=STUDENT_OPT_IN_N
)
print(f"   {len(opted_alumni)} opted-in alumni, {len(opted_students)} opted-in students")

print("3. Synthesizing opt-in-form fields (career goals, capacity, preferences)...")
print("   NOTE: synthetic/illustrative data standing in for a real form -- see synthetic_profile.py")
opted_alumni = synthesize_alumni_fields(opted_alumni, seed=SEED)
opted_students = synthesize_student_fields(opted_students, seed=SEED)

print("4. Splitting the opted-in population into train / live...")
train_alumni, live_alumni = train_live_split(opted_alumni, live_frac=LIVE_FRAC, seed=SEED)
train_students, live_students = train_live_split(opted_students, live_frac=LIVE_FRAC, seed=SEED)
print(f"   alumni: {len(train_alumni)} train / {len(live_alumni)} live")
print(f"   students: {len(train_students)} train / {len(live_students)} live")

print("5. Fitting the feature encoder on the train split only...")
encoder = FeatureEncoder(Weights(major=1.0, hobbies=1.0, trait=1.0, location=0.75, track=1.25)).fit(
    pd.concat([train_alumni, train_students], ignore_index=True)
)
live_alumni_vecs = encoder.transform(live_alumni)
live_student_vecs = encoder.transform(live_students)

live_id_to_vec = {}
for i, pid in enumerate(live_alumni["person_id"]):
    live_id_to_vec[pid] = live_alumni_vecs[i]
for i, pid in enumerate(live_students["person_id"]):
    live_id_to_vec[pid] = live_student_vecs[i]

live_alumni_ids = live_alumni["person_id"].tolist()
live_student_ids = live_students["person_id"].tolist()
capacity = dict(zip(live_alumni["person_id"], live_alumni["capacity"]))

print("6. Batch cold-start assignment over the live population (the compatibility ceiling)...")
ceiling_groups, ceiling_total = capacitated_assignment(
    live_student_ids, live_student_vecs, live_alumni_ids, live_alumni_vecs, capacity
)
ceiling_matched = sum(len(v) for v in ceiling_groups.values())
print(f"   {ceiling_matched}/{len(live_students)} students matched, total compatibility = {ceiling_total:.2f}")

print("7. Simulating the actual live product flow: one student at a time, greedy top pick...")
print("   (this is what recommend_for_student would produce in production, not a batch sweep)")
live_index = MentorIndex(live_alumni_ids, live_alumni_vecs)
greedy_remaining_capacity = dict(capacity)
greedy_groups = {aid: [] for aid in live_alumni_ids}
for i, sid in enumerate(live_student_ids):
    picks = recommend_for_student(
        live_student_vecs[i], live_index, live_id_to_vec, greedy_remaining_capacity, show_k=1
    )
    if picks:
        aid = picks[0]
        greedy_groups[aid].append(sid)
        greedy_remaining_capacity[aid] -= 1

greedy_matched = sum(len(v) for v in greedy_groups.values())
greedy_total = total_compatibility(greedy_groups, live_id_to_vec)
print(f"   {greedy_matched}/{len(live_students)} students matched, total compatibility = {greedy_total:.2f}")
print(f"   greedy-live achieves {100 * ceiling_ratio(greedy_total, ceiling_total):.1f}% of the batch-optimal ceiling")

print("8. Example live recommendation with a hard filter...")
example_student_idx = 0
example_student_id = live_student_ids[example_student_idx]
example_track = live_students.iloc[example_student_idx]["target_track"]
mentor_df_indexed = live_alumni.set_index("person_id")
filtered_picks = recommend_for_student(
    live_student_vecs[example_student_idx],
    live_index,
    live_id_to_vec,
    dict(capacity),
    mentor_df_indexed=mentor_df_indexed,
    hard_filters={"mentor_tracks": example_track},
    show_k=3,
)
print(f"   student {example_student_id} (wants '{example_track}') -> recommended: {filtered_picks or '(no eligible mentors)'}")

print("9. Exporting the ceiling assignment to JSON for manual review...")
run_stats = {
    "n_alumni_opted_in": len(opted_alumni),
    "n_students_opted_in": len(opted_students),
    "n_alumni_live": len(live_alumni),
    "n_students_live": len(live_students),
    "ceiling_students_matched": ceiling_matched,
    "ceiling_total_score": round(ceiling_total, 2),
    "greedy_live_students_matched": greedy_matched,
    "greedy_live_total_score": round(greedy_total, 2),
    "greedy_live_pct_of_ceiling": round(100 * ceiling_ratio(greedy_total, ceiling_total), 1),
}
unmatched = [sid for sid in live_student_ids if sid not in {s for ss in ceiling_groups.values() for s in ss}]
live_population = pd.concat([live_alumni, live_students], ignore_index=True)
out_path = export_matches_to_json(
    ceiling_groups, live_population, OUTPUT_PATH, id_to_vec=live_id_to_vec, unmatched_ids=unmatched, run_stats=run_stats,
)
print(f"   wrote {out_path}")

print("10. Logging example match events (suggested/accepted -- mechanical actions, safe to log directly)...")
event_log = JsonlEventLog(EVENT_LOG_PATH)
if filtered_picks:
    top_pick = filtered_picks[0]
    event_log.append(MatchEvent(event_type="suggested", student_id=example_student_id, alumnus_id=top_pick))
    event_log.append(MatchEvent(event_type="accepted", student_id=example_student_id, alumnus_id=top_pick))
    print(f"   logged 2 events to {EVENT_LOG_PATH}: {[e.event_type for e in event_log.read_all()]}")

print("11. One illustrative FeedbackForm example (schema validation only -- NOT real data, NOT used for training)...")
example_feedback = FeedbackForm(
    match_id=f"{example_student_id}-{filtered_picks[0]}" if filtered_picks else "example",
    respondent_role="student",
    satisfaction_rating=5,
    would_match_again=True,
    sessions_held=2,
    relationship_status="ongoing",
    primary_goal_progress="some",
    free_text_comments="(illustrative example only, not a real response)",
)
print(f"   {example_feedback}")

