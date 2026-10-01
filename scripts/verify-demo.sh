#!/usr/bin/env bash
#
# End-to-end walkthrough of the demo path against a running stack.
#
# Start the app first (`npm run dev`), then run this. It drives the same HTTP API
# the browser uses — real cookies, real rate limits, the real matching worker —
# so it catches the class of problem unit tests cannot: a seeded database that
# doesn't match the schema, a stale server on the port, a CORS or cookie setting
# that only breaks over the wire, or an ML worker that never became ready.
#
# Every step asserts. The script stops at the first failure with the response
# body that caused it, so a red run tells you what to fix rather than just that
# something is wrong.
#
# The script is re-runnable. Steps that can only happen once against a given
# database (accepting a request, giving feedback, registering for an event) detect
# that they already happened and report it as prior state rather than failing —
# so a second run stays green without needing a reseed. For a run that exercises
# every transition from scratch:
#
#   npm run db:reset && npm run db:seed        # then restart the stack
#
# Usage:
#   ./scripts/verify-demo.sh [base-url]        # default http://127.0.0.1:3001/api

set -Eeuo pipefail

BASE="${1:-http://127.0.0.1:3001/api}"
JAR_DIR="$(mktemp -d)"
trap 'rm -rf "$JAR_DIR"' EXIT

# Counters live in files for the same reason the status code does: `ok` and `bad`
# are reached from inside $(...) captures, and a shell variable incremented in a
# subshell is discarded when it exits — the tally would silently undercount.
PASS_FILE="$JAR_DIR/pass"; printf '0' > "$PASS_FILE"
FAIL_FILE="$JAR_DIR/fail"; printf '0' > "$FAIL_FILE"
PRIOR_FILE="$JAR_DIR/prior"; : > "$PRIOR_FILE"
STEP=""

bump() { local file="$1"; printf '%s' "$(( $(cat "$file") + 1 ))" > "$file"; }

BOLD=$'\033[1m'; GREEN=$'\033[32m'; RED=$'\033[31m'; DIM=$'\033[2m'; OFF=$'\033[0m'

# All reporting goes to stderr, not stdout. `expect` returns the response body on
# stdout for the caller to parse, so a pass/fail line written there would be
# captured as part of the JSON and break every assertion that follows.
section() { printf '\n%s── %s%s\n' "$BOLD" "$1" "$OFF" >&2; }
ok()      { bump "$PASS_FILE"; printf '  %s✓%s %s\n' "$GREEN" "$OFF" "$1" >&2; }
bad()     { bump "$FAIL_FILE"; printf '  %s✗%s %s\n' "$RED" "$OFF" "$1" >&2; [ -n "${2:-}" ] && printf '    %s%s%s\n' "$DIM" "$2" "$OFF" >&2; return 0; }

# Reports the line that aborted the run; without it `set -e` exits silently.
trap 'printf "\n%sAborted during: %s (line %s)%s\n" "$RED" "${STEP:-startup}" "$LINENO" "$OFF"' ERR

# ---------------------------------------------------------------------------
# HTTP helpers. Each role keeps its own cookie jar, which is what makes the
# authorization assertions below meaningful.
# ---------------------------------------------------------------------------

jar() { printf '%s/%s.jar' "$JAR_DIR" "$1"; }

# api <role> <method> <path> [json-body] → body on stdout; status via `status`
#
# The status code goes to a file rather than a variable because callers capture
# the body with $(...), which runs this in a subshell — a variable set here would
# never reach them.
api() {
  local role="$1" method="$2" path="$3" body="${4:-}"
  local args=(-sS -o "$JAR_DIR/body" -w '%{http_code}'
              -X "$method" "$BASE$path"
              -b "$(jar "$role")" -c "$(jar "$role")"
              -H 'Origin: http://localhost:5173')

  if [ -n "$body" ]; then
    args+=(-H 'Content-Type: application/json' -d "$body")
  fi

  curl "${args[@]}" > "$JAR_DIR/status"
  cat "$JAR_DIR/body"
}

# Status code of the most recent `api` call.
status() { cat "$JAR_DIR/status" 2>/dev/null || echo '000'; }

# expect <role> <method> <path> <expected-status> <label> [body]
expect() {
  local role="$1" method="$2" path="$3" want="$4" label="$5" body="${6:-}"
  STEP="$label"
  local response; response="$(api "$role" "$method" "$path" "$body")"

  local got; got="$(status)"
  if [ "$got" = "$want" ]; then
    ok "$label"
  else
    bad "$label — wanted HTTP $want, got $got" "$(printf '%s' "$response" | head -c 300)"
  fi
  printf '%s' "$response"
}

# Reads a value out of a JSON response without requiring jq to be installed.
json() { python3 -c '
import json, sys
data = json.load(sys.stdin)
for key in sys.argv[1].split("."):
    if isinstance(data, list):
        data = data[int(key)]
    else:
        data = data[key]
print("" if data is None else data)
' "$1"; }

assert_eq() {
  STEP="$3"
  if [ "$1" = "$2" ]; then ok "$3"; else bad "$3 — wanted '$2', got '$1'"; fi
}

assert_true() {
  STEP="$2"
  if [ "$1" = "True" ] || [ "$1" = "true" ]; then ok "$2"; else bad "$2 — got '$1'"; fi
}

# Reports a step that was already satisfied by a previous run. Counted as a pass,
# but flagged so the summary can say the run was not against a fresh database.
prior() {
  bump "$PASS_FILE"
  printf '  %s✓%s %s %s(already done in an earlier run)%s\n' "$GREEN" "$OFF" "$1" "$DIM" "$OFF" >&2
  printf 'x' >> "$PRIOR_FILE"
  return 0
}

login() {
  local role="$1" email="$2" password="$3"
  STEP="login $email"
  local response; response="$(api "$role" POST /auth/login "{\"email\":\"$email\",\"password\":\"$password\"}")"

  if [ "$(status)" != "200" ]; then
    bad "login $email" "$(printf '%s' "$response" | head -c 300)"
    printf '\n%sCannot continue without a session. Is the database seeded? (npm run db:seed)%s\n' "$RED" "$OFF"
    exit 1
  fi
  ok "login $email"
}

printf '%sDemo walkthrough against %s%s\n' "$BOLD" "$BASE" "$OFF"

# ---------------------------------------------------------------------------
section 'Health and dependencies'
# ---------------------------------------------------------------------------

STEP='health'
HEALTH="$(curl -sS "$BASE/health")"
assert_eq "$(printf '%s' "$HEALTH" | json status)" 'ok' 'API is healthy'
assert_eq "$(printf '%s' "$HEALTH" | json database)" 'ok' 'database responds'

MATCHING="$(printf '%s' "$HEALTH" | json matching)"
# The worker fits its encoder at boot; give it a moment rather than failing a
# run that started a second too early.
for _ in $(seq 1 30); do
  [ "$MATCHING" = 'ready' ] && break
  sleep 1
  MATCHING="$(curl -sS "$BASE/health" | json matching)"
done
if [ "$MATCHING" = 'ready' ]; then
  ok 'matching worker is ready'
else
  bad "matching worker is '$MATCHING', not ready" 'recommendations will use the fallback ranking'
fi

# ---------------------------------------------------------------------------
section 'Public content (no session)'
# ---------------------------------------------------------------------------

LANDING="$(expect anon GET /content/landing 200 'landing content is public')"
assert_true "$(printf '%s' "$LANDING" | python3 -c 'import json,sys; print(len(json.load(sys.stdin).get("testimonials", [])) > 0)')" \
            'landing page carries testimonials'

expect anon GET /mentors 401 'mentor directory requires a session' >/dev/null
expect anon GET /admin/users 401 'admin directory requires a session' >/dev/null

# ---------------------------------------------------------------------------
section 'Demo logins'
# ---------------------------------------------------------------------------

login student student@demo.com 'Student123!'
login alumni  alumni@demo.com  'Alumni123!'
login admin   admin@demo.com   'Admin123!'

ME="$(expect student GET /auth/me 200 'session survives on a fresh request')"
assert_eq "$(printf '%s' "$ME" | json user.role)" 'student' 'student session reports the right role'
STEP='credential leak check'
if printf '%s' "$ME" | grep -Eqi '"(password|password_hash|password_salt|salt)"'; then
  bad 'session response contains no credential fields'
else
  ok 'session response contains no credential fields'
fi

login_rejected="$(api anon POST /auth/login '{"email":"student@demo.com","password":"wrong-password"}')"
assert_eq "$(status)" '401' 'a wrong password is rejected'

# ---------------------------------------------------------------------------
section 'Student journey — search, recommendations, request'
# ---------------------------------------------------------------------------

DIRECTORY="$(expect student GET '/mentors?limit=5' 200 'mentor directory paginates')"
assert_true "$(printf '%s' "$DIRECTORY" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["items"]) <= 5)')" \
            'the limit is honoured server-side'

SEARCH="$(expect student GET '/mentors?q=data&available=true' 200 'search filters run in SQL')"

RECS="$(expect student GET '/mentors/recommendations?limit=4' 200 'ML recommendations return')"
SOURCE="$(printf '%s' "$RECS" | json source)"
COUNT="$(printf '%s' "$RECS" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["items"]))')"
ok "recommendation source: $SOURCE ($COUNT mentors)"
assert_true "$([ "$COUNT" -gt 0 ] && echo true || echo false)" 'at least one mentor was recommended'

# Request the demo alumnus specifically. Picking the top-ranked ML mentor instead
# would leave the request sitting in a seeded account nobody logs into, and the
# accept/capacity/feedback steps below would have nothing to act on.
DEMO_MENTOR="$(api alumni GET /mentors/me)"
MENTOR_ID="$(printf '%s' "$DEMO_MENTOR" | json mentor.id)"
MENTOR_NAME="$(printf '%s' "$DEMO_MENTOR" | json mentor.name)"
# The mentor's real open slots, so the request names a bookable time rather than
# free text nothing can check.
STEP='read the mentor open slots'
SLOTS="$(api student GET "/scheduling/slots/$MENTOR_ID?days=21")"
SLOT_COUNT="$(printf '%s' "$SLOTS" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["slots"]))')"
assert_true "$([ "$SLOT_COUNT" -gt 0 ] && echo true || echo false)" \
            "$MENTOR_NAME publishes $SLOT_COUNT bookable slot(s)"

WANTED_AT="$(printf '%s' "$SLOTS" | json slots.0.startsAt)"
WANTED_LABEL="$(printf '%s' "$SLOTS" | json slots.0.label)"

STEP='send a mentorship request'
REQUEST="$(api student POST /mentorship/requests \
  "{\"mentorProfileId\":\"$MENTOR_ID\",\"interest\":\"Machine learning career path\",\"preferredSlot\":\"$WANTED_LABEL\",\"preferredSlotAt\":\"$WANTED_AT\",\"message\":\"I would value guidance on internships and portfolio building.\"}")"

REQUEST_SENT=no
case "$(status)" in
  201)
    ok "request sent to $MENTOR_NAME"
    REQUEST_SENT=yes
    ;;
  409)
    # Two distinct prior states both answer 409: a pending request from an
    # interrupted run, or a mentorship already established by a complete one.
    prior "request to $MENTOR_NAME"
    ;;
  *)
    bad 'send a mentorship request' "$(printf '%s' "$REQUEST" | head -c 300)"
    ;;
esac

# Whatever the state, asking twice must never produce two live requests.
DUP="$(api student POST /mentorship/requests \
  "{\"mentorProfileId\":\"$MENTOR_ID\",\"interest\":\"Machine learning career path\",\"preferredSlot\":\"$WANTED_LABEL\",\"message\":\"Trying to double-book the same mentor deliberately.\"}")"
assert_eq "$(status)" '409' 'a repeat request to the same mentor is refused'

# ---------------------------------------------------------------------------
section 'Authorization boundaries'
# ---------------------------------------------------------------------------

expect student GET  /admin/users        403 'student cannot read the admin directory' >/dev/null
expect student GET  /admin/stats        403 'student cannot read platform stats' >/dev/null
expect student GET  /mentors/me         403 'student cannot hold a mentor profile' >/dev/null
expect alumni  GET  /mentors/recommendations 403 'alumni cannot request student recommendations' >/dev/null

STEP='forged cookie'
FORGED="$(curl -sS -o "$JAR_DIR/body" -w '%{http_code}' "$BASE/auth/me" \
  -H 'Cookie: mentorship_token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLWRlbW8tYWRtaW4iLCJyb2xlIjoiYWRtaW4ifQ.not-a-valid-signature')"
assert_eq "$FORGED" '401' 'a forged session token is rejected'

STEP='sql injection'
INJECT="$(api student GET "/mentors?q=%25%27%20OR%201%3D1%20--")"
assert_eq "$(status)" '200' 'SQL metacharacters are handled as text'
assert_eq "$(printf '%s' "$INJECT" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["items"]))')" '0' \
          'the injected OR matched nothing'
STILL_THERE="$(api student GET '/mentors?limit=1')"
assert_true "$(printf '%s' "$STILL_THERE" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["items"]) > 0)')" \
            'the mentor table is intact afterwards'

# ---------------------------------------------------------------------------
section 'Alumni journey — inbox, accept, capacity'
# ---------------------------------------------------------------------------

PROFILE="$(expect alumni GET /mentors/me 200 'alumni can read their mentor profile')"
CAPACITY_BEFORE="$(printf '%s' "$PROFILE" | json mentor.capacity)"
REMAINING_BEFORE="$(printf '%s' "$PROFILE" | json mentor.remainingCapacity)"
ok "capacity $CAPACITY_BEFORE, $REMAINING_BEFORE remaining"

INBOX="$(expect alumni GET /mentorship/requests 200 'alumni can see their request inbox')"
PENDING_ID="$(printf '%s' "$INBOX" | python3 -c '
import json, sys
requests = json.load(sys.stdin)["requests"]
pending = [r for r in requests if r["status"] == "pending"]
print(pending[0]["id"] if pending else "")
')"

if [ -n "$PENDING_ID" ]; then
  # Authorization first: the request must be answerable only by its own mentor.
  expect admin PATCH "/mentorship/requests/$PENDING_ID" 403 'a non-owner cannot answer the request' \
    '{"status":"accepted"}' >/dev/null

  ACCEPTED="$(expect alumni PATCH "/mentorship/requests/$PENDING_ID" 200 'alumni accepts a request' \
    '{"status":"accepted","responseNotes":"Happy to help — let us start next week."}')"

  # Accepting a request that named a time books that time, so the mentorship
  # starts with a real appointment rather than a note nobody acted on.
  FIRST_AT="$(printf '%s' "$ACCEPTED" | python3 -c '
import json, sys
session = json.load(sys.stdin).get("firstSession")
print(session["scheduledAt"] if session else "")
')"
  assert_eq "$FIRST_AT" "$WANTED_AT" 'accepting booked the requested slot as the first session'

  REPEAT="$(api alumni PATCH "/mentorship/requests/$PENDING_ID" \
    '{"status":"declined","responseNotes":"Changed my mind."}')"
  assert_eq "$(status)" '409' 'responding twice to one request is refused'

  AFTER="$(api alumni GET /mentors/me)"
  REMAINING_AFTER="$(printf '%s' "$AFTER" | json mentor.remainingCapacity)"
  assert_eq "$REMAINING_AFTER" "$((REMAINING_BEFORE - 1))" 'accepting consumed one capacity slot'
else
  prior 'accepting a request'
fi

RELATIONSHIPS="$(expect alumni GET /mentorship/relationships 200 'the mentorship appears for the alumnus')"
REL_COUNT="$(printf '%s' "$RELATIONSHIPS" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["relationships"]))')"
assert_true "$([ "$REL_COUNT" -gt 0 ] && echo true || echo false)" "relationship row exists ($REL_COUNT)"

# Capacity is derived from active relationships, so the two must agree however the
# relationship came about — this holds on a fresh run and a repeat one alike.
CAPACITY_NOW="$(api alumni GET /mentors/me)"
assert_eq "$(printf '%s' "$CAPACITY_NOW" | json mentor.remainingCapacity)" \
          "$(( CAPACITY_BEFORE - REL_COUNT ))" \
          'remaining capacity equals capacity minus active mentorships'

# ---------------------------------------------------------------------------
section 'Match event log (DESIGN_BACKLOG #4)'
# ---------------------------------------------------------------------------

STATS="$(expect admin GET /admin/stats 200 'admin reads platform stats')"
MATCH_EVENTS="$(printf '%s' "$STATS" | json stats.matchEvents)"
assert_true "$([ "$MATCH_EVENTS" -gt 0 ] && echo true || echo false)" \
            "match events were logged ($MATCH_EVENTS rows)"

# ---------------------------------------------------------------------------
section 'Scheduling — availability and booking'
# ---------------------------------------------------------------------------

AVAIL="$(expect alumni GET /scheduling/availability/me 200 'mentor reads their own weekly schedule')"
WINDOW_COUNT="$(printf '%s' "$AVAIL" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["availability"]["windows"]))')"
assert_true "$([ "$WINDOW_COUNT" -gt 0 ] && echo true || echo false)" \
            "$WINDOW_COUNT weekly availability window(s) published"

expect student GET "/scheduling/availability/$MENTOR_ID" 200 'a student can read published availability' >/dev/null
expect student PUT /scheduling/availability/me 403 'a student cannot publish availability' \
  '{"windows":[]}' >/dev/null

STEP='overlapping windows are refused'
OVERLAP="$(api alumni PUT /scheduling/availability/me \
  '{"windows":[{"dayOfWeek":2,"startTime":"17:00","endTime":"19:00"},{"dayOfWeek":2,"startTime":"18:00","endTime":"20:00"}]}')"
assert_eq "$(status)" '400' 'overlapping availability windows are refused'

# ── Booking at any point in the mentorship, not only when requesting ────────

if [ "$REL_COUNT" -gt 0 ]; then
  BOOK_REL="$(printf '%s' "$RELATIONSHIPS" | json relationships.0.id)"

  STEP='an already-booked slot disappears from the list'
  REMAINING="$(api student GET "/scheduling/slots/$MENTOR_ID?days=21")"

  # Only meaningful when this run actually booked something. On a re-run the
  # request was a no-op, $WANTED_AT was recomputed from the currently-open slots,
  # and it is correctly still available.
  if [ "$REQUEST_SENT" = 'yes' ]; then
    STILL_OFFERED="$(printf '%s' "$REMAINING" | python3 -c "
import json, sys
wanted = '$WANTED_AT'
print('yes' if any(s['startsAt'] == wanted for s in json.load(sys.stdin)['slots']) else 'no')
")"
    assert_eq "$STILL_OFFERED" 'no' 'the booked slot is no longer offered'
  else
    prior 'checking the booked slot was withdrawn'
  fi

  NEXT_AT="$(printf '%s' "$REMAINING" | json slots.0.startsAt)"

  BOOKED="$(expect student POST /scheduling/sessions 201 'student books a later session' \
    "{\"relationshipId\":\"$BOOK_REL\",\"title\":\"Portfolio review\",\"scheduledAt\":\"$NEXT_AT\",\"notes\":\"Bringing my GitHub repo.\"}")"
  SESSION_ID="$(printf '%s' "$BOOKED" | json session.id)"
  assert_eq "$(printf '%s' "$BOOKED" | json session.scheduledAt)" "$NEXT_AT" \
            'the session stores the real timestamp'

  # The rules a UI must not be trusted to enforce.
  expect student POST /scheduling/sessions 409 'the same slot cannot be booked twice' \
    "{\"relationshipId\":\"$BOOK_REL\",\"title\":\"Duplicate\",\"scheduledAt\":\"$NEXT_AT\"}" >/dev/null

  OFF_CADENCE="$(python3 -c "
from datetime import datetime, timedelta
start = datetime.fromisoformat('$NEXT_AT'.replace('Z', '+00:00'))
print((start + timedelta(minutes=7)).isoformat().replace('+00:00', 'Z'))
")"
  expect student POST /scheduling/sessions 409 'a time off the mentor cadence is refused' \
    "{\"relationshipId\":\"$BOOK_REL\",\"title\":\"Off cadence\",\"scheduledAt\":\"$OFF_CADENCE\"}" >/dev/null

  PAST="$(python3 -c "
from datetime import datetime, timedelta, timezone
print((datetime.now(timezone.utc) - timedelta(days=2)).replace(microsecond=0).isoformat().replace('+00:00', 'Z'))
")"
  expect student POST /scheduling/sessions 400 'a time in the past is refused' \
    "{\"relationshipId\":\"$BOOK_REL\",\"title\":\"Last week\",\"scheduledAt\":\"$PAST\"}" >/dev/null

  expect admin POST /scheduling/sessions 403 'an outsider cannot book into the mentorship' \
    "{\"relationshipId\":\"$BOOK_REL\",\"title\":\"Not mine\",\"scheduledAt\":\"$NEXT_AT\"}" >/dev/null

  # ── Reschedule and cancel ────────────────────────────────────────────────
  MOVE_TO="$(api student GET "/scheduling/slots/$MENTOR_ID?days=21" | json slots.0.startsAt)"
  MOVED="$(expect student PATCH "/scheduling/sessions/$SESSION_ID" 200 'the session can be rescheduled' \
    "{\"scheduledAt\":\"$MOVE_TO\"}")"
  assert_eq "$(printf '%s' "$MOVED" | json session.scheduledAt)" "$MOVE_TO" 'it moved to the new slot'

  expect student PATCH "/scheduling/sessions/$SESSION_ID" 400 'a future session cannot be marked held' \
    '{"status":"completed"}' >/dev/null

  expect admin PATCH "/scheduling/sessions/$SESSION_ID" 403 'an outsider cannot change the session' \
    '{"status":"cancelled"}' >/dev/null

  expect alumni PATCH "/scheduling/sessions/$SESSION_ID" 200 'the mentor can cancel it' \
    '{"status":"cancelled","cancelledReason":"Clashes with a work deadline."}' >/dev/null

  STEP='a cancelled slot frees up'
  FREED="$(api student GET "/scheduling/slots/$MENTOR_ID?days=21" | python3 -c "
import json, sys
wanted = '$MOVE_TO'
print('yes' if any(s['startsAt'] == wanted for s in json.load(sys.stdin)['slots']) else 'no')
")"
  assert_eq "$FREED" 'yes' 'the cancelled slot is bookable again'

  SESSIONS="$(expect student GET '/scheduling/sessions?scope=upcoming' 200 'upcoming sessions list loads')"
  STEP='session labels'
  if printf '%s' "$SESSIONS" | grep -Eq '"slotLabel": *"[^"]*(AM|PM) +(AM|PM)"'; then
    bad 'session times render cleanly'
  else
    ok 'session times render cleanly'
  fi
else
  bad 'no mentorship to book against' 'expected the accepted request above to create one'
fi

# ---------------------------------------------------------------------------
section 'Community visibility (DESIGN_BACKLOG #1)'
# ---------------------------------------------------------------------------

STEP='create a group'
GROUP="$(api alumni POST /groups \
  '{"name":"Demo Verification Circle","topic":"Checking creator-only visibility","description":"Created by the demo walkthrough to prove the visibility rule holds."}')"
if [ "$(status)" = '201' ]; then
  ok 'alumni created a group'
  GROUP_ID="$(printf '%s' "$GROUP" | json group.id)"
  assert_eq "$(printf '%s' "$GROUP" | json group.visibility)" 'alumni-only' 'new group defaults to alumni-only'

  expect student GET "/groups/$GROUP_ID" 404 'student cannot reach an alumni-only group by id' >/dev/null
  expect admin PATCH "/groups/$GROUP_ID/visibility" 403 'even an admin cannot override the creator' \
    '{"visibility":"open-to-students"}' >/dev/null

  OPENED="$(expect alumni PATCH "/groups/$GROUP_ID/visibility" 200 'the creator can open it to students' \
    '{"visibility":"open-to-students"}')"
  assert_eq "$(printf '%s' "$OPENED" | json group.visibility)" 'open-to-students' 'visibility changed'
  assert_eq "$(printf '%s' "$OPENED" | json message)" 'Group is now open to students.' 'the message reads correctly'

  expect student GET "/groups/$GROUP_ID" 200 'student can now see the group' >/dev/null
  expect student POST "/groups/$GROUP_ID/join" 200 'student can join the opened group' >/dev/null
else
  bad 'create a group' "$(printf '%s' "$GROUP" | head -c 300)"
  GROUP_ID=''
fi

# ---------------------------------------------------------------------------
section 'Messaging'
# ---------------------------------------------------------------------------

STEP='student session id'
STUDENT_ID="$(api student GET /auth/me | json user.id)"
ALUMNI_ID="$(api alumni GET /auth/me | json user.id)"

CONV="$(expect student POST /conversations 201 'student opens a conversation with the mentor' \
  "{\"participantUserId\":\"$ALUMNI_ID\"}")"
CONV_ID="$(printf '%s' "$CONV" | json conversationId)"

expect student POST "/conversations/$CONV_ID/messages" 201 'student sends a message' \
  '{"text":"Thank you for accepting — when would suit you for a first call?"}' >/dev/null
expect alumni POST "/conversations/$CONV_ID/messages" 201 'mentor replies' \
  '{"text":"Thursday at 5pm works well. I will send an invite."}' >/dev/null

THREAD="$(expect student GET "/conversations/$CONV_ID/messages" 200 'student reads the thread')"
assert_eq "$(printf '%s' "$THREAD" | json messages.0.from)" 'me' "the student's own message shows as theirs"
assert_eq "$(printf '%s' "$THREAD" | json messages.1.from)" 'them' "the mentor's message shows as theirs"

UNREAD="$(api student GET /conversations | python3 -c '
import json, sys
conversations = json.load(sys.stdin)["conversations"]
print(sum(c["unreadCount"] for c in conversations))
')"
ok "student has $UNREAD unread message(s)"
expect student POST "/conversations/$CONV_ID/read" 200 'marking the thread read' >/dev/null
CLEARED="$(api student GET /conversations | python3 -c '
import json, sys
conversations = json.load(sys.stdin)["conversations"]
print(sum(c["unreadCount"] for c in conversations))
')"
assert_eq "$CLEARED" '0' 'the unread badge cleared'

# 403 (not a participant) and 404 (thread hidden entirely) are both acceptable;
# what matters is that the content is withheld.
STEP='outsider cannot read the thread'
OUTSIDER="$(api admin GET "/conversations/$CONV_ID/messages")"
case "$(status)" in
  403 | 404) ok "an outsider cannot read the thread (HTTP $(status))" ;;
  *) bad "an outsider cannot read the thread — got $(status)" "$(printf '%s' "$OUTSIDER" | head -c 200)" ;;
esac

# ---------------------------------------------------------------------------
section 'Feedback (DESIGN_BACKLOG #5)'
# ---------------------------------------------------------------------------

PENDING="$(expect student GET /feedback/pending 200 'student is prompted for feedback')"
REL_ID="$(printf '%s' "$PENDING" | python3 -c '
import json, sys
pending = json.load(sys.stdin)["pending"]
print(pending[0]["relationshipId"] if pending else "")
')"

if [ -z "$REL_ID" ] && [ "$REL_COUNT" -gt 0 ]; then
  # Nothing pending but a mentorship exists: this student has already answered.
  prior 'submitting feedback'
elif [ -n "$REL_ID" ]; then
  expect student POST /feedback 201 'student submits human-entered feedback' \
    "{\"relationshipId\":\"$REL_ID\",\"satisfactionRating\":5,\"wouldMatchAgain\":true,\"sessionsHeld\":2,\"relationshipStatus\":\"ongoing\",\"primaryGoalProgress\":\"significant\",\"freeTextComments\":\"The portfolio review was the most useful part.\"}" >/dev/null

  expect student POST /feedback 409 'the same person cannot rate it twice' \
    "{\"relationshipId\":\"$REL_ID\",\"satisfactionRating\":1,\"wouldMatchAgain\":false,\"sessionsHeld\":0,\"relationshipStatus\":\"ended\",\"primaryGoalProgress\":\"none\"}" >/dev/null

  expect student POST /feedback 400 'an out-of-range rating is rejected' \
    "{\"relationshipId\":\"$REL_ID\",\"satisfactionRating\":9,\"wouldMatchAgain\":true,\"sessionsHeld\":1,\"relationshipStatus\":\"ongoing\",\"primaryGoalProgress\":\"some\"}" >/dev/null
else
  bad 'no mentorship to give feedback on' 'expected the accepted request above to create one'
fi

# Either way, a non-participant must never be able to rate someone else's
# mentorship — the check that matters most here.
if [ "$REL_COUNT" -gt 0 ]; then
  ANY_REL="$(printf '%s' "$RELATIONSHIPS" | json relationships.0.id)"
  expect admin POST /feedback 403 'a non-participant cannot rate a mentorship' \
    "{\"relationshipId\":\"$ANY_REL\",\"satisfactionRating\":1,\"wouldMatchAgain\":false,\"sessionsHeld\":0,\"relationshipStatus\":\"ended\",\"primaryGoalProgress\":\"none\"}" >/dev/null
fi

# ---------------------------------------------------------------------------
section 'Events'
# ---------------------------------------------------------------------------

EVENTS="$(expect student GET /events 200 'events list loads')"
# The API returns upcoming events only (and an ISO startsAt), so "upcoming" is a
# timestamp comparison rather than a status string.
UPCOMING="$(printf '%s' "$EVENTS" | python3 -c '
import json, sys
from datetime import datetime, timezone
now = datetime.now(timezone.utc)
events = json.load(sys.stdin)["events"]
print(sum(1 for e in events if datetime.fromisoformat(e["startsAt"].replace("Z", "+00:00")) >= now))
')"
assert_true "$([ "$UPCOMING" -gt 0 ] && echo true || echo false)" "$UPCOMING upcoming event(s) for the demo"

STEP='event time labels'
if printf '%s' "$EVENTS" | grep -Eq '"time": *"[^"]*(AM|PM) +(AM|PM)"'; then
  bad 'event times render cleanly' 'a range meridiem was captured as a timezone label'
else
  ok 'event times render cleanly'
fi

EVENT_ID="$(printf '%s' "$EVENTS" | json events.0.id)"
REG="$(api student POST "/events/$EVENT_ID/register" '{}')"
case "$(status)" in
  200 | 201) ok 'student registered for an event' ;;
  409) prior 'registering for an event' ;;
  *) bad 'event registration' "$(printf '%s' "$REG" | head -c 200)" ;;
esac

# ---------------------------------------------------------------------------
section 'Admin journey — verification and announcements'
# ---------------------------------------------------------------------------

USERS="$(expect admin GET /admin/users 200 'admin reads the user directory')"
STEP='admin directory credential check'
if printf '%s' "$USERS" | grep -Eqi 'password|salt'; then
  bad 'user directory leaks no credential fields'
else
  ok 'user directory leaks no credential fields'
fi

QUEUE="$(expect admin GET /admin/verifications 200 'verification queue loads')"
VER_ID="$(printf '%s' "$QUEUE" | python3 -c '
import json, sys
entries = json.load(sys.stdin)["verifications"]
pending = [v for v in entries if v["status"] == "pending"]
print(pending[0]["id"] if pending else "")
')"

if [ -n "$VER_ID" ]; then
  expect admin PATCH "/admin/verifications/$VER_ID" 200 'admin approves a verification' \
    '{"status":"approved"}' >/dev/null
else
  prior 'approving a verification'
fi

expect admin POST /admin/announcements 201 'admin publishes an announcement' \
  '{"title":"Mentorship cohort opens Monday","audience":"students","body":"Submit your career-goals form before Friday to be matched in this cohort."}' >/dev/null

# ---------------------------------------------------------------------------
section 'Logout'
# ---------------------------------------------------------------------------

expect student POST /auth/logout 200 'logout succeeds' >/dev/null
expect student GET  /auth/me     401 'the session is gone afterwards' >/dev/null

# ---------------------------------------------------------------------------
PASS="$(cat "$PASS_FILE")"
FAIL="$(cat "$FAIL_FILE")"
PRIOR="$(wc -c < "$PRIOR_FILE" | tr -d ' ')"
if [ "$PRIOR" -gt 0 ]; then
  printf '\n%s%s step(s) were already satisfied by an earlier run against this database.%s\n' \
    "$DIM" "$PRIOR" "$OFF"
  printf '%sFor a run that exercises every transition from scratch: npm run db:reset && npm run db:seed%s\n' \
    "$DIM" "$OFF"
fi
printf '\n%s%d passed, %d failed%s\n' "$BOLD" "$PASS" "$FAIL" "$OFF"
[ "$FAIL" -eq 0 ] || exit 1
printf '%sDemo path verified end to end.%s\n' "$GREEN" "$OFF"
