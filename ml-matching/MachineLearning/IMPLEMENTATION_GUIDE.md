# Implementation guide: retrieve-then-rank matching engine

This walks through `matching_engine/` and `run_demo.py`. It replaces the
earlier Tier 1 design (capacitated stable matching via Gale-Shapley /
Hospital-Residents), which has been retired — see "Why stable matching was
replaced" below for the reasoning.

## 0. What data this runs against, and why it's synthetic in places

`student_profiles.json` (23,236 records: 5,889 with `Year == "Senior"`,
17,347 without) is the full population. Two things about it matter for
everything downstream:

- **No real opt-in exists yet.** Nobody has actually signed up for a
  mentorship program — there's no student career-goals form and no alumni
  mentor-join form (tracked in `DESIGN_BACKLOG.md`). Until those exist,
  `matching_engine.sampling.sample_opt_in_population` takes a random
  sample of each pool to stand in for "the people who opted in."
- **The opt-in-form fields don't exist in the raw data either.**
  `matching_engine.synthetic_profile` generates plausible values for them
  (career goals, target track, mentor capacity, availability, etc.),
  derived from each person's *existing* profile fields rather than pure
  noise. This is explicitly synthetic/illustrative data for exercising the
  pipeline — never real user input, and never used to train anything (see
  §5).

Once real forms exist, swap step 2-3 of `run_demo.py` for reading real
submissions; nothing else in the pipeline needs to change, since it's
already built against this schema.

## 1. Install

```bash
pip install -r requirements.txt          # runtime only
pip install -r requirements-dev.txt       # + pytest, for running tests
```

## 2. Module map

| Module | Responsibility |
|---|---|
| `data.py` | `load_data`, `split_alumni_students` — load the full population, proxy-split by `Year == "Senior"` |
| `sampling.py` | `sample_opt_in_population`, `train_live_split` — simulate opt-in, then split into train (fit/tune) vs. live (serve) |
| `synthetic_profile.py` | Generates the opt-in-form fields for the sampled population; `MAJOR_TO_TRACK` maps the 70 observed majors onto the 8 landing-page tracks |
| `constants.py` | Shared vocabulary (`TRACKS`, `CADENCES`, `FORMATS`, `SUPPORT_OPTIONS`) |
| `features.py` | `FeatureEncoder` — one weighted, sparse compatibility vector per person |
| `retrieval.py` | `MentorIndex` (built once, queried live) and `build_candidate_lists` (batch top-K) |
| `ranking.py` | `recommend_for_student` — the live, per-student entry point: hard filters -> retrieval -> capacity filter -> MMR-diversified shortlist |
| `assignment.py` | `capacitated_assignment` — the batch/cold-start solver (Hungarian, per-mentor capacity) |
| `evaluation.py` | `total_compatibility`, `ceiling_ratio` |
| `events.py` | `MatchEvent` / `JsonlEventLog` — behavioral action logging (suggested/accepted/declined) |
| `feedback_schema.py` | `FeedbackForm` — the post-match survey schema; validates shape only, generates nothing |
| `export.py` | `export_matches_to_json` — human-readable export for manual review |

## 3. What to tune

| What | Where | Notes |
|---|---|---|
| Opt-in sample size | `sample_opt_in_population(alumni_n=, student_n=)` | Defaults ~5% of each pool; set to your actual target pilot size (e.g. one school) once known |
| Train/live split | `train_live_split(live_frac=)` | Default 30% held out for live serving/demo |
| Feature weights | `FeatureEncoder(Weights(...))` | `major`, `hobbies`, `trait`, `location`, `track` |
| Live candidate breadth | `recommend_for_student(top_k_candidates=)` | How many mentors are retrieved before filtering/diversifying |
| Options shown to a student | `recommend_for_student(show_k=)` | How many diversified recommendations to actually display |
| Diversity vs. compatibility | `recommend_for_student(lam=)` / `mmr_select(lam=)` | 1.0 = pure compatibility, 0.0 = pure diversity |
| Mentor capacity | Real per-mentor `capacity` field (synthetic today, `synthesize_alumni_fields`) | No more uniform constant |

## 4. Why stable matching was replaced

The earlier design used Gale-Shapley / Hospital-Residents because both
sides have "preference lists" and capacity — on paper a natural fit. The
problem: those preference lists were never real. They were entirely
derived from one symmetric similarity score computed the same way for
both sides — nobody involved actually stated or ranked anything. Stable
matching's guarantee ("no two participants would both rather swap") is a
real, valuable property when preferences are genuinely elicited and a
market-clearing event matters (residency matching, school admissions). It
protects against nothing meaningful when the "preferences" are a
byproduct of the matching algorithm's own scoring.

Separately, the product this feeds (see the frontend) is inherently
online: a student browses or searches, sends a request, an alumnus
accepts or declines — one at a time, continuously, not a synchronized
batch event. A live retrieve-then-rank query (`recommend_for_student`)
matches that shape directly; a from-scratch full-cohort stable-matching
run every time doesn't.

What replaced it:
- **Day to day**: `recommend_for_student` — a live query against a
  `MentorIndex`, filtered to mentors with remaining capacity, diversified
  via MMR. No stability property is computed or needed.
- **Cold-start / periodic sweeps** (e.g. the initial pilot cohort, or a
  periodic pass over students with no live match yet):
  `capacitated_assignment` — a single Hungarian-algorithm optimization
  maximizing total compatibility subject to each mentor's own capacity.
  This is the same seat-duplication technique the old pipeline used only
  as a benchmark ceiling (`hungarian_benchmark`), now promoted to the
  actual solver — so there's no more three-stage
  stable-match -> MMR-diversify -> repair-displaced pipeline, and no more
  "displaced student" concept, because nothing is being pulled out of an
  already-decided group after the fact.
- **MMR diversification** moved from "diversify a mentor's assigned
  roster" to "diversify the options shown to one student" — the same
  algorithm, applied to a more natural target.
- **Stability auditing is retired.** There's no elicited-preference market
  whose "no blocking pair" property would mean anything here, so
  `audit_blocking_pairs` isn't carried forward. `evaluation.py`'s
  `total_compatibility`/`ceiling_ratio` keep the part that's still
  meaningful: how good is a result, compared to the best possible?

`run_demo.py` demonstrates the honest version of that comparison: it runs
`capacitated_assignment` once as the ceiling, then *separately* simulates
what the live, one-student-at-a-time `recommend_for_student` flow would
actually produce (greedy top pick, capacity depleting as it goes), and
reports what fraction of the ceiling the live flow reaches. That gap is
the real cost of serving matches online instead of solving one big batch
optimization — worth watching as the pilot runs.

## 5. Tier 2 — explicitly gated on real human feedback

No synthetic feedback is generated and nothing is trained on fabricated
labels — see `feedback_schema.py`'s module docstring. What exists today is
the **schema** a real post-match survey should collect (`FeedbackForm`),
with each field chosen for what it would contribute to a future learned
re-ranker (explicit labels: `satisfaction_rating`, `would_match_again`;
implicit engagement: `sessions_held`, `relationship_status`; outcome:
`primary_goal_progress`). `events.py`'s `MatchEvent`/`JsonlEventLog` is
safe to log automatically today (suggested/accepted/declined are actions,
not opinions) — `run_demo.py` demonstrates that part directly.

Once a real pilot is collecting real `FeedbackForm` responses and
`MatchEvent` logs, that data — not anything generated by this codebase —
is what a Tier 2 ranker (e.g. `sklearn.linear_model.LogisticRegression` to
start, more later) would train on, layered on top of the same
`FeatureEncoder` vectors already being computed.

## 6. Upgrading text matching to semantic embeddings

`FeatureEncoder` uses TF-IDF (lexical overlap) by default so it runs fully
offline. With internet access, swap in `sentence-transformers` for
semantic matching (e.g. "hiking" scoring close to "trekking"):

```python
from sentence_transformers import SentenceTransformer
model = SentenceTransformer("all-MiniLM-L6-v2")
vecs = model.encode(list_of_texts, normalize_embeddings=True)
```

Replace the `TfidfVectorizer` calls in `FeatureEncoder.fit`/`.transform`
for `Major`, `Hobbies`, and the trait/goal text. Nothing else in the
pipeline needs to change — it only depends on getting a vector per person.
`Story`'s long narrative text is still unused by `FeatureEncoder` today;
it's a reasonable candidate to fold into the trait block once embeddings
are in place (TF-IDF handles short text much better than multi-paragraph
narrative).

## 7. Running the tests and the demo

```bash
pytest                # fast, deterministic, no dependency on the full 23k-record run
python run_demo.py    # end-to-end against the real student_profiles.json population
```

`run_demo.py` writes `match_results.json` (human-readable export) and
`match_events.jsonl` (example event log) into this directory — both are
demo output, not meant to be committed.
