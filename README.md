# Strathmore Alumni Connect

A mentorship platform that connects Strathmore University students with alumni for career guidance, and gives alumni a peer space of their own for collaboration. Student-to-mentor matching is done by a Python machine-learning engine; everything else runs on a TypeScript API over an embedded database.

The whole stack runs locally with one command and no external services — no Docker, no database server, no cloud account.

![Landing page](frontend/docs/screenshots/landing-desktop.png)

---

## Contents

- [Architecture](#architecture)
- [Quick start](#quick-start)
- [Demo accounts](#demo-accounts)
- [A five-minute demo path](#a-five-minute-demo-path)
- [Screenshots](#screenshots)
- [Project layout](#project-layout)
- [How matching works](#how-matching-works)
- [Insights](#insights)
- [Scheduling](#scheduling)
- [Mentorship lifecycle](#mentorship-lifecycle)
- [Opportunities, events and announcements](#opportunities-events-and-announcements)
- [Roles and access](#roles-and-access)
- [Profiles and photos](#profiles-and-photos)
- [Notifications and live updates](#notifications-and-live-updates)
- [Mentorship quality](#mentorship-quality)
- [Email](#email)
- [Trust, safety and your data](#trust-safety-and-your-data)
- [Security](#security)
- [Testing](#testing)
- [Scripts](#scripts)
- [Configuration](#configuration)
- [Known limits](#known-limits)

---

## Architecture

Three pieces, one process to start:

```text
┌─────────────────────┐   HTTP + httpOnly cookie   ┌──────────────────────┐
│  frontend  :5173    │ ─────────────────────────► │  backend  :3001      │
│  React 19 + Vite    │ ◄───────────────────────── │  Fastify 5 + TS      │
└─────────────────────┘                            └──────────┬───────────┘
                                                              │
                                    ┌─────────────────────────┴──────────┐
                                    │                                    │
                              node:sqlite                     NDJSON over stdio
                              (app.db, WAL)                              │
                                                              ┌──────────▼──────────┐
                                                              │  matching worker     │
                                                              │  python3 + sklearn   │
                                                              └──────────────────────┘
```

**Why this shape.** The matching engine is Python (scikit-learn, pandas) and the API is TypeScript, so the two have to meet somewhere. Measuring settled it: a cold Python start costs **6.3 s**, while a query against an already-warm index costs **3.7 ms**. Spawning a process per request was therefore never viable, and a second HTTP service would have meant a second thing to run and supervise. Instead the API starts one long-lived Python worker at boot and talks to it over newline-delimited JSON on stdin/stdout, supervising it the way a process manager would: exponential backoff on crash, a per-request timeout so a hung worker cannot hang the API, and a `warming | ready | down` state reported on `/api/health`. If the worker is unavailable, recommendations fall back to a deterministic ranking and the response says `"source": "fallback"` — a degradation, not an outage.

**In production it is one process.** `npm run serve` builds the frontend and has the API serve it from the same origin, so there is no CORS, no cross-origin cookie and one port to put behind a TLS proxy. The two dev servers above are for development only. [docs/OPERATIONS.md](docs/OPERATIONS.md) covers running it, logs, backups and the path to Postgres.

**One contract.** The API's wire types live in `backend/src/contract/` — plain types, no imports. The backend annotates its responses with them and the frontend imports the same file (as `@contract`, type-only), so renaming a field breaks both compilers instead of a screen. The session, capabilities, admin, reports, import and insights types are there so far; others move over when next touched.

**Why these dependencies.** The backend has ten runtime dependencies and no ORM, no bcrypt, and no database server. `node:sqlite` (built into Node 24) gives a real relational database in a file; `node:crypto`'s scrypt gives password hashing; SQL goes through prepared statements in a thin repository layer, which prevents injection structurally rather than by escaping.

| | |
|---|---|
| **Frontend** | React 19, React Router 7, TanStack Query 5, Vite 8, plain CSS with design tokens |
| **Backend** | Node 24, Fastify 5, TypeScript (strict), Zod, `node:sqlite`, `node:crypto` scrypt |
| **Matching** | Python 3, scikit-learn, pandas, NumPy |

---

## Quick start

**Requirements:** Node ≥ 24 (for `node:sqlite`), Python 3.10+, and the matching engine's Python packages.

```bash
# 1. Install dependencies for both apps
npm --prefix backend install
npm --prefix frontend install

# 2. Python packages for the matching engine
pip install -r ml-matching/MachineLearning/requirements.txt

# 3. Create the backend config and a signing secret
cp backend/.env.example backend/.env
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
#    …paste the output as JWT_SECRET= in backend/.env

# 4. Create the database and load demo data
npm run db:reset && npm run db:seed

# 5. Set up the local email inbox (once; downloads Mailpit into .tools/)
npm run mail          # Ctrl-C once it says it is running

# 6. Start everything
npm run dev
```

Then open **http://localhost:5173**. Emails the platform sends — confirm-your-email and password-reset links — appear at **http://localhost:8025**.

`npm run dev` starts the API, waits for `/api/health` to go green, then starts the frontend and, if it has been set up, Mailpit, prefixing each process's logs so a stack trace is attributable at a glance. Ctrl-C stops all of them. If either port is already in use it refuses to start rather than silently attaching you to a stale server.

The API will not start without a `JWT_SECRET` of at least 32 characters. That is deliberate — a generated fallback would change on every restart and quietly invalidate every session, and a weak one undermines the whole session model.

---

## Demo accounts

Seeded by `npm run db:seed`. The sign-in page has one-click fill buttons for each.

| Role    | Email              | Password     | What it shows |
|---------|--------------------|--------------|---------------|
| Student | `student@demo.com` | `Student123!` | Recommendations, mentor search, requests, sessions, feedback |
| Alumni  | `alumni@demo.com`  | `Alumni123!`  | Request inbox, capacity, mentees, communities, opportunities |
| Admin   | `admin@demo.com`   | `Admin123!`   | Verification queue, user directory, announcements, platform stats |

Alongside the three curated accounts, the seed loads a sampled population from the ML dataset — **304 mentors and 901 students** — so search, pagination, and matching behave as they would with real volume rather than against four rows. Every seeded mentor is given weekly availability so booking works immediately; the four curated ones get a full Monday-to-Friday spread.

---

## A five-minute demo path

This is the path `scripts/verify-demo.sh` exercises automatically; these are the same steps by hand.

1. **Landing page, signed out.** Scroll the benefits, collaboration and career-track sections. Everything here is served from the API's public content endpoint.
2. **Sign in as the student.** The dashboard's "Recommended for you" panel is live output from the matching engine, with a match score per mentor. If the panel notes that matching is warming up, wait a few seconds and refresh — that is the fallback ranking being honest about itself.
3. **Find a mentor and request mentorship.** Search filters (name, company, skill, industry, availability) run server-side in SQL, not over a downloaded table. Open **Dr. Amina Osei** — the demo alumni account — and note the *Availability* panel on her profile. The request form's "preferred first session" dropdown lists her real open slots; pick one and send the request.
4. **Sign in as the alumnus.** The request is in the inbox, showing the time the student asked for. Accept it: remaining capacity drops by one *and* the requested slot is booked as the first session, which the confirmation names. Capacity is *derived* from active relationships rather than stored, so it cannot drift. Try responding a second time and it is refused.
5. **Set your availability** under the *Availability* tab. Add or remove weekly windows, change the session length, and save. Try entering two overlapping windows on one day — it is refused with a readable message. Your upcoming sessions are listed underneath.
6. **Back as the student, open *My sessions*.** The first session is there with a real date and time. Book another from any active mentorship — booking is not limited to the moment a request is sent. Reschedule one onto a different slot, or cancel it and watch that slot become available again.
7. **Message each other.** Open the thread from either side; each person sees their own messages on the right. Opening a thread clears its unread badge.
8. **Create a community as the alumnus.** It defaults to alumni-only. Sign in as the student and confirm it is not listed — and not reachable by its id either. Back as its creator, flip it to open-to-students, and the student can now see and join it. No one else can flip that switch, including an admin.
9. **Give feedback as the student.** Under "My sessions", the accepted mentorship prompts a feedback form. These responses are the only source of Tier-2 training data; none of it is ever synthesised.
10. **Sign in as the admin.** Approve someone in the verification queue (which also activates their account), post an announcement, and check the platform stats — every number is counted from the database, including the match-event log.
11. **Reload the page.** The session survives, because it is a signed httpOnly cookie rather than a localStorage blob.

To confirm all of that without clicking, with the stack running:

```bash
./scripts/verify-demo.sh        # 99 assertions against the live API
```

It is safe to run more than once: steps that can only happen once against a given database (accepting a request, giving feedback, registering for an event) recognise that they already happened and say so, rather than failing. Reseed first if you want every transition exercised from scratch.

---

## Screenshots

| | |
|---|---|
| ![Mentor search](frontend/docs/screenshots/mentor-search.png)<br>Mentor search | ![Mentor profile](frontend/docs/screenshots/mentor-profile.png)<br>Mentor profile |
| ![Student dashboard](frontend/docs/screenshots/student-dashboard.png)<br>Student dashboard | ![Admin dashboard](frontend/docs/screenshots/admin-dashboard.png)<br>Admin dashboard |
| ![Messaging](frontend/docs/screenshots/messaging.png)<br>Messaging | ![Communities](frontend/docs/screenshots/communities.png)<br>Communities |
| ![Events](frontend/docs/screenshots/events.png)<br>Events | ![Sign in](frontend/docs/screenshots/auth.png)<br>Sign in |

<details>
<summary>Mobile view</summary>

![Landing page on mobile](frontend/docs/screenshots/landing-mobile.png)

</details>

---

## Project layout

```text
.
├── backend/                    # Fastify API
│   └── src/
│       ├── config/             # env validation, .env loader, rate-limit policy
│       ├── db/
│       │   ├── migrations/     # forward-only, checksum-tracked SQL
│       │   ├── seed/           # curated demo data + sampled ML population
│       │   ├── connection.ts   # node:sqlite handle, pragmas, transactions
│       │   └── repository.ts   # prepared-statement helpers
│       ├── lib/                # password hashing, ids, time, slots, validation, errors
│       ├── modules/            # one folder per domain: routes + service + repo
│       │                       #   (auth, mentors, seekers, mentorship, scheduling,
│       │                       #    communities, messaging, events, feedback, admin)
│       ├── plugins/            # auth (JWT cookie, guards), matching worker
│       └── services/matching/  # the supervised Python bridge
│
├── frontend/                   # React SPA
│   └── src/
│       ├── app/                # shell, session bootstrap
│       ├── components/         # layout + UI primitives
│       ├── config/             # navigation, option lists
│       ├── features/           # landing, auth, onboarding, mentors, dashboards,
│       │                       #   scheduling, messaging, communities, events, feedback
│       ├── lib/                # http client + typed API modules
│       └── types/              # the API contract as the client sees it
│
├── ml-matching/MachineLearning/
│   ├── matching_engine/        # the engine (unchanged by this integration)
│   ├── ml_bridge/              # worker.py (NDJSON protocol) + export_seed.py
│   └── tests/                  # 43 tests
│
├── scripts/
│   ├── dev.mjs                 # starts + supervises both servers
│   ├── serve.mjs               # the one-process production build
│   └── verify-demo.sh          # end-to-end walkthrough against a live stack
│
├── e2e/                        # Playwright browser + accessibility tests
├── docs/OPERATIONS.md          # running, logs, backups, moving to Postgres
├── .github/workflows/ci.yml    # verify + browser tests on every push
│
├── src/                        # the original Figma design export, kept for
│                               #   visual reference (npm run dev:design)
├── DESIGN_BACKLOG.md
└── PROJECT_STRUCTURE.md
```

### API surface

All routes are under `/api`. Everything except `/api/health`, `/api/auth/*` and `/api/content/landing` requires a session.

| Area | Routes |
|---|---|
| Auth | `POST /auth/signup`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `POST /auth/verify-email`, `POST /auth/resend-verification`, `POST /auth/forgot-password`, `POST /auth/reset-password` |
| Account | `PATCH /account` (name), `POST /account/password`, `PUT|DELETE /account/avatar`, `GET /users/:id/avatar`, `POST /account/accept-terms`, `GET /account/export` (download my data), `POST /account/delete` |
| Safety | `GET|POST /blocks`, `DELETE /blocks/:userId`, `POST /reports` |
| Notifications | `GET /notifications`, `POST /notifications/:id/read`, `POST /notifications/read-all`, `GET /notifications/stream` (server-sent events) |
| Mentors | `GET /mentors` (search, filters, pagination, facets), `GET /mentors/:id`, `GET /mentors/recommendations`, `GET|POST|PATCH /mentors/me` (`GET` also returns the owner's `editable` form fields) |
| Students | `GET|POST|PATCH /seekers/me` |
| Mentorship | `POST /mentorship/requests`, `GET /mentorship/requests`, `PATCH /mentorship/requests/:id`, `POST /mentorship/requests/:id/withdraw`, `GET /mentorship/relationships`, `POST /mentorship/relationships/:id/end`, `POST /mentorship/relationships/:id/checkin`, `POST /mentorship/relationships/:id/goals`, `PATCH|DELETE /mentorship/goals/:id` |
| Office hours | `GET /office-hours`, `GET /office-hours/mine`, `POST /office-hours`, `POST|DELETE /office-hours/:id/join`, `POST /office-hours/:id/cancel` |
| Alumni | `GET /alumni` (directory: search, class year, industry, paging) |
| Opportunities | `GET /opportunities` (`q`, `type`), `GET /opportunities/mine`, `POST /opportunities`, `POST /opportunities/:id/close`, `GET /opportunities/:id/applications`, `POST /opportunities/:id/apply` |
| Announcements | `GET /announcements` (the caller's audience) |
| Scheduling | `GET|PUT /scheduling/availability/me`, `GET /scheduling/availability/:mentorProfileId`, `GET /scheduling/slots/:mentorProfileId`, `GET /scheduling/sessions`, `POST /scheduling/sessions`, `PATCH /scheduling/sessions/:id`, `POST /scheduling/sessions/:id/rating`, `GET /scheduling/sessions/:id/calendar.ics` |
| Communities | `GET /groups`, `POST /groups`, `GET /groups/:id`, `DELETE /groups/:id` (admin moderation), `POST /groups/:id/join`, `DELETE /groups/:id/leave`, `PATCH /groups/:id/visibility` |
| Messaging | `GET /conversations`, `POST /conversations`, `GET|POST /conversations/:id/messages`, `POST /conversations/:id/read` |
| Events | `GET /events`, `POST|DELETE /events/:id/register`, `GET /events/:id/calendar.ics`; admins: `POST /events`, `PATCH /events/:id`, `POST /events/:id/cancel`, `GET /events/:id/attendees` |
| Feedback | `GET /feedback/pending`, `POST /feedback` |
| Admin | `GET /admin/verifications`, `PATCH /admin/verifications/:id`, `GET /admin/users` (`q`, `role`, `status`, `page`, `limit`), `PATCH /admin/users/:id/status`, `DELETE /admin/users/:id/avatar`, `GET|POST /admin/announcements`, `GET /admin/audit`, `GET /admin/stats`, `GET /admin/insights` (`days`: 30, 90 or 365), `GET /admin/insights/evaluation`, `GET /admin/reports`, `PATCH /admin/reports/:id`, `POST /admin/alumni/import` (CSV, with a dry run) |
| Content | `GET /content/landing`, `GET /content/dashboard/stats` |
| Health | `GET /health` |

---

## How matching works

A student's profile is vectorised by the engine's fitted feature encoder and scored against the mentor index. Two details matter for correctness:

- **Capacity stays in the database, not the model.** Each recommendation call passes the current remaining-capacity map, computed as `capacity − COUNT(active relationships)`. The worker never holds its own opinion about who is full, so it cannot recommend a mentor who has just accepted their last mentee.
- **New students take the same path as seeded ones.** A student who was never part of the sampled population is encoded on the fly from their opt-in form through the same fitted encoder, so there is no separate cold-start branch to drift.

Every suggestion shown and every accept or decline is written to `match_events`, with the suggestion's score and position. That log is what a learned re-ranker would train on later; the feedback forms are the other half. No feedback is ever generated synthetically — a Tier-2 model waits for real human responses, by design.

**What the student sees is re-ranked by behaviour** (`backend/src/services/matching/rerank.ts`). The matcher is asked for three times as many candidates as are shown, and each candidate's compatibility is multiplied by two factors before the top few are kept. Both are plain arithmetic over the event log; neither changes the match score the student sees.

- **Reliability.** The share of a mentor's requests from the last 180 days that they answered rather than let expire, smoothed so a new mentor or a single miss barely moves them. A mentor who never answers keeps 60% of their score; one who usually takes more than three days to answer loses a further 10%.
- **Exposure.** How many other students the mentor was suggested to this week, per free seat. Beyond three per seat, the score is eased down, so a few well-described mentors do not top everyone's list while others are never shown.

## Insights

*Admin → Insights* answers the questions the university asks of the programme, from the platform's own records.

- **Supply and demand** — for each track, students still waiting for a mentor against the free seats of mentors offering it, sorted by shortfall: where to recruit alumni.
- **From suggestion to mentorship** — every student–mentor pair first suggested in the last 30, 90 or 365 days, followed to a request, an acceptance, a first held session and feedback, each step counted only if it came after the suggestion. Beside it: how often requests are accepted when they followed a suggestion versus when the student found the mentor another way, and the typical time to answer.
- **Is the matcher right?** — take-up by match score and by position in the list: if the scores mean something, the top rows should be asked for and accepted more. The matching engine also scores every mentorship that formed against the best assignment of the same students to the same mentors' capacities (the engine's own `evaluation.ceiling_ratio` over `capacitated_assignment`), and compares the fit of accepted pairs with declined ones.
- **Requests left unanswered** — mentors whose requests lapsed, least responsive first, to nudge.

---

## Scheduling

Sessions are real appointments, not notes. A mentor publishes when they are free; a student picks from what that generates.

**Mentors declare recurring availability**, not individual dates — "Tuesdays 17:00–19:00" is a weekly rule stored as a weekday plus minute offsets, alongside the session length they want (15–120 minutes) and their timezone (EAT, CAT, SAST, WAT, GMT or UTC). The windows are wall-clock times in that timezone — what the mentor typed — and every slot is converted to the real UTC instant from them. Overlapping windows on the same day are refused rather than silently merged, because a mentor who enters one twice has made a mistake worth telling them about.

**Bookable slots are derived at read time** by stepping through each window at the mentor's own cadence and removing anything already committed — for both people, across every mentorship they hold. A mentor is one person: a slot taken by one student is unavailable to another. Slots that would run past the end of a window are never offered, and neither is anything in the past.

**A booking must land on a slot the mentor actually offered.** Being merely *inside* a window is not enough: 17:07 sits inside 17:00–19:00 but is not on the cadence, and accepting it would fragment the rest of the day. Rescheduling revalidates the same way, so a `PATCH` cannot be used to get around the rules a `POST` enforces.

**Double-booking is prevented by unique indexes**, not just by a check. Two concurrent requests can both pass an application-level "is this free?" test and both then insert; only the database can refuse the second. Cancelled sessions are excluded from those indexes, so a freed slot becomes bookable again.

**Requesting mentorship names a real time.** The request form offers the mentor's open slots, and accepting the request books the chosen one as the first session — so the time a student asked for actually becomes an appointment. That booking is deliberately best-effort and outside the acceptance transaction: if the slot has since gone, the mentorship is still accepted and the two agree a new time, because a scheduling detail should not veto a mentor's decision.

**Booking is available for the whole life of a mentorship**, from either side, under *My sessions* for a student and *Availability* for a mentor. Sessions can be rescheduled onto another open slot, cancelled with a reason, or marked as held once they have passed — which is what the "sessions held" figure on the feedback form counts.

Times are stored as ISO 8601 UTC and shown on the owner's clock: a mentor's timezone for sessions, an event's own timezone for events. Each supported timezone is a fixed offset from UTC, which is exact because none of them observes daylight saving; see [Known limits](#known-limits).

## Mentorship lifecycle

- **Mentorships run for a 12-week term**, with a short check-in from each side at the halfway point ("on track" or "needs attention", plus an optional note). When the term ends the mentorship closes by itself.
- **Either side can end one early**, with an optional reason. Ending frees the mentor's seat, cancels sessions that have not happened yet, and prompts both people for feedback. Their message thread stays.
- **Requests are capped and expire.** A student can have at most three requests waiting at once, and an unanswered request expires after a week — so popular mentors are not flooded and students are not left waiting indefinitely. A student can withdraw a request the mentor has not answered.
- **The time-based steps** (expiry and term ends) run in an in-process sweep at startup and hourly (`backend/src/plugins/lifecycle.ts`).

## Opportunities, events and announcements

- **Any verified alumnus can post an opportunity**, mentor or not. Students see open ones on their dashboard and apply; the poster sees each applicant's name, email and note, and can close applications.
- **Admins run events**: schedule them on a wall clock in a chosen timezone, edit them, cancel them (registrants still see them, marked cancelled), and see who registered.
- **Announcements reach their audience**: each account sees what was sent to everyone plus what was sent to its role.
- **Every admin action is logged** (verification decisions, suspensions, announcements, event changes, community removals) with who did it, written in the same transaction as the action. Admins see it under *Activity log*.

---

## Email

In development every email goes to **Mailpit**, a local test inbox: it pretends to be a mail server on port 1025 and shows each message on a web page at http://localhost:8025, where the links can be clicked. Nothing leaves the machine. `npm run mail` downloads it the first time from Mailpit's official GitHub releases into `.tools/` (git-ignored; no system install, no sudo), checking the file's SHA-256 against the digest GitHub records for that release before running it. After that, `npm run dev` starts it automatically.

- **Confirming an address.** Signing up sends a link, valid for 24 hours. Confirming never blocks using the platform; a banner asks for it, with a *Send it again* button. Seeded demo accounts count as confirmed.
- **Resetting a password.** *Forgot your password?* on the sign-in page emails a link valid for one hour, once. The page answers the same whether or not the address has an account, so it cannot be used to find out who is registered. Setting the new password signs out every device and also confirms the address.
- **Tokens** are 32 random bytes; only their SHA-256 is stored, and a newer link voids older ones for the same purpose.
- **Sending never blocks a request.** Mail goes out after the database work commits; if Mailpit or the mail server is unreachable, the API logs that and carries on, and the person can ask for the email again.
- **For a real deployment**, point `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/`MAIL_FROM` at a real relay (a university SMTP relay, or a provider such as Brevo, Mailgun or Amazon SES) and set `APP_URL` to the site's public address. `MAIL_TRANSPORT=console` prints emails to the API log instead, for when neither is available.

## Mentorship quality

- **Goals.** Each mentorship has a shared list of up to five goals that either side can add, tick off or remove, so progress has something concrete to be measured against.
- **A rating after every held session** — one to five stars and an optional comment, once per person. It is quicker, finer Tier-2 signal than the end-of-mentorship form, and like that form it is only ever entered by a person.
- **Why a mentor was suggested.** Recommendations carry up to three plain reasons ("Mentors in Data Science", "Also studied Computer Science", "Also based in Nairobi"), from literal overlaps between the student's answers and the mentor's profile.
- **Office hours.** A mentor opens one time to several students — any student, not only their mentees. It counts as a commitment for the mentor and for everyone who joins, so one-to-one slots at that time disappear and nobody can be double-booked against it. The meeting link is shown only to those who joined.
- **The opportunities board** (`/opportunities`) lists every open opportunity with search, a type filter and application deadlines; posters set a closing date, which ends at midnight East Africa Time.
- **The alumni directory** (`/alumni-directory`), for alumni only, finds verified alumni by name, class year, programme, company or industry — never showing email addresses — with a Message button on every card.

## Notifications and live updates

- **A bell in the top bar** shows unread notifications. Each one links to the page where it can be acted on, and opening it marks it read. What triggers one:
  - a mentorship request received, accepted, declined, withdrawn or expired, and a mentorship ended;
  - a session booked, moved or cancelled by the other person, and a reminder in the day before it;
  - a new message — one per conversation, updated as messages arrive, and cleared when the thread is read;
  - an alumni verification decision, an announcement, a cancelled event you registered for, an application to your opportunity, and a community of yours being removed.
- **Notifications are written in the same transaction as the action**, so one exists exactly when the thing it describes does. Announcements are copied to each recipient with a single `INSERT … SELECT`, so every notification has the same per-person read state.
- **Live updates** arrive over server-sent events (`GET /api/notifications/stream`). The stream carries hints — "your notifications changed", "a message arrived in conversation X" — and the page refetches through the ordinary authorised routes, so nothing on the stream has skipped a permission check. Pages still poll slowly as a fallback, so a proxy that drops the stream makes the app less fresh, not wrong. The hub is in-process: with more than one API process, a hint only reaches browsers connected to the process that sent it (see [Known limits](#known-limits)).
- **Meeting links and calendars.** A session can carry an https meeting link, and sessions and events download as `.ics` files for any calendar app. Times in the file are UTC, which calendars convert to their owner's timezone.

## Profiles and photos

- **Every role has a Profile tab.** Its *Account* section changes the name, the password and the photo; below it, students edit their career goals and mentors their whole mentor profile — the same forms as onboarding, prefilled. Matching runs on these answers, so a student's suggestions refresh when their goals change.
- **Changing a password signs out every other device.** Each token records the account's session version; a password change moves the version on, so older tokens stop working, while the device that made the change is issued a fresh one.
- **Photos are optional** and fall back to initials. The browser crops a photo to a square and shrinks it to 256×256 before uploading, so the server never decodes images and needs no native image library. The server still trusts nothing the client says about the file: it reads the type from the file's own bytes (JPEG, PNG or WebP only, and it must match the declared type), caps the size at 300 KB, and names the file itself. Photos are stored beside the database under `uploads/avatars/` and served only to signed-in users.
- **Admins can remove a photo** from the Users tab, for moderation; the removal is recorded in the activity log.

## Roles and access

Who may do what is defined once, in `backend/src/lib/policy.ts`, as a list of **capabilities** per role. Routes guard on a capability (`app.requireCapability('mentorship.request')`), and `/api/auth/me` returns the caller's list, from which the frontend builds its top bar, sidebar and buttons — so the UI never offers an action the API would refuse.

| | Student | Alumni | Admin |
|---|---|---|---|
| Browse mentors | ✓ | ✓ | — |
| Request mentorship, get recommendations | ✓ | — | — |
| Mentor students | — | optional — via the mentor-join form | — |
| Sessions, feedback | ✓ | ✓ | — |
| Messages | with mentors they have requested | with requesters and other alumni | — |
| Communities | join the ones open to students | join and create | view and remove, never join |
| Events | view, register | view, register | view, schedule, edit, cancel, see attendees |
| Opportunities | view, apply | view, post, see applicants | — |
| Office hours | join | host (mentors) | — |
| Alumni directory | — | ✓ | — |
| Verify alumni, manage users, announce | — | — | ✓ |

- **Alumni are verified before they can do anything.** Signing up as an alumnus asks for a class year and programme and puts the account in the admin's verification queue. Until it is approved the account has no capabilities, and the app shows a waiting screen.
- **Mentoring is optional for alumni.** An alumnus who never fills in the mentor form is a full member of the network; the mentor tabs appear once they do.
- **Suspension is immediate.** Every request re-reads the account's role and status from the database rather than trusting the 12-hour token, so a suspended user is signed out on their next click.
- **Dashboard tabs are URLs** (`/alumni/availability`, `/admin/users`), so they survive a reload and can be linked to.

---

## Security

The prototype's security model was the main thing this build replaced. Previously, demo passwords shipped in plaintext inside the JS bundle and the session was an unsigned `localStorage` JSON blob — editing it to `{"role":"admin"}` granted admin. Both are gone.

**Authentication.** Passwords are hashed with scrypt (N=2¹⁶, r=8, p=1) and a per-user random salt, compared with `timingSafeEqual`. Hashes never leave the database layer; no response anywhere contains a password or salt field, and there is a test asserting that on the raw response body. Login answers a wrong password and an unknown account identically, so it cannot be used to enumerate accounts.

**Sessions.** A signed JWT in an `httpOnly`, `SameSite=Lax` cookie with a 12-hour lifetime, marked `Secure` outside development. `httpOnly` puts it out of reach of any XSS that does get through; the signature makes role tampering fail closed; `SameSite=Lax` blunts CSRF on state-changing requests. The token only says *who* the caller is: their role and status are read from the database on every request, so a suspension or an approval takes effect immediately, and each token carries the account's session version, so changing the password signs out every other device.

**Authorization.** Capability guards from the single policy in `lib/policy.ts` (see [Roles and access](#roles-and-access)), plus ownership checks in the service layer, never only in the UI. Specifically: a mentor can only answer requests addressed to them; only a group's creator can change its visibility (an admin cannot override them, only remove the group); only a mentorship's two participants can give feedback on it; only a conversation's participants can read it; and a conversation can only be opened between people the messaging rule links.

**Input handling.** Every route boundary validates with Zod before anything reaches the database. All SQL is prepared statements with bound parameters — injection is prevented by construction, and a test confirms that `%' OR 1=1 --` in the search box matches nothing and leaves the table intact.

**Transport and rate limiting.** Helmet sets CSP, HSTS, `X-Content-Type-Options`, `Referrer-Policy` and frame protections. API-only, the CSP forbids loading anything; serving the page, it allows only the site's own scripts, styles and API (plus the landing photo). CORS is pinned to the single configured browser origin with credentials allowed. A global rate limit (`RATE_LIMIT_PER_MINUTE`, default 300) applies to everything, with 10 a minute on the auth routes, and body size is capped.

**Tracing a failure.** Every response carries an `X-Request-Id` that also tags every log line the request wrote; a 500's body includes it, so a reported error can be found in the logs.

**Dependencies.** `npm audit` reports **0 vulnerabilities** across backend and frontend. Getting there meant upgrading `@fastify/jwt` to v10 — v9 depended on a `fast-jwt` with two critical auth-bypass advisories (algorithm confusion, and cache confusion returning claims from a different token) — and `vitest` to v5.

Run the checks yourself:

```bash
npm --prefix backend audit && npm --prefix frontend audit
npm --prefix backend test           # includes tests/security.test.ts
./scripts/verify-demo.sh            # includes the live authorization probes
```

---

## Trust, safety and your data

- **Consent.** Signing up needs a tick against the [privacy notice](frontend/src/features/legal/LegalPages.tsx) and code of conduct, and the version accepted is recorded. When the notice changes (`CURRENT_TERMS_VERSION` in `backend/src/lib/terms.ts`), everyone is asked once more at `/consent` before they can carry on; until then the API refuses everything except accepting, downloading their data, deleting their account and signing out — someone who disagrees with the new terms can still take their data and leave. Both texts are drafts to be reviewed by Strathmore's data protection officer before launch.
- **Report and block.** A profile, a conversation or a single message can be reported, with a reason. Blocking someone stops either side messaging or sending a mentorship request to the other; the blocked person is not told. Blocks are listed, and can be undone, under *Account → Your data*.
- **The reports queue.** Admins see open reports first, with the reported message quoted (only if the reported person wrote it) and how often that person has been reported in total. Actioning or dismissing is audited and tells the reporter the outcome, never the note. Suspension, when warranted, is done from *Users*.
- **Download my data.** `GET /api/account/export` returns everything the platform holds about the account as JSON — profile, requests, mentorships, sessions, messages, feedback and so on. Passwords are not included, not even hashed.
- **Deleting an account** is immediate once the password is re-entered, and anonymises rather than erases, so the other side of a conversation or mentorship keeps a coherent history. Active mentorships are ended first and the other side told; pending requests are withdrawn; future office hours are cancelled and attendees told. Profiles, skills, availability, registrations, applications and notifications are removed; the text of every message the person sent becomes "Message removed", and their written feedback, rating comments and check-in notes are cleared. The account itself is kept only as "Former member" with an unusable email and password, so it cannot sign in and cannot be found. The last admin cannot delete themselves.
- **Directory visibility.** An alumnus can leave the alumni directory under *Account → Privacy* and keep mentoring: students still find their mentor profile through mentor search.
- **Bulk alumni import.** *Admin → Import alumni* takes the alumni office's register as a CSV (name, email, class year, programme; headers are matched loosely; up to 500 rows). A preview marks each row ready, already registered, or needing a fix, and nothing is created until *Import*. Imported alumni are verified immediately and emailed an invitation, valid for a week, to set their own password.

## Testing

```bash
npm test                 # backend (283) + frontend (91) + ML engine (43)
npm run typecheck        # tsc --noEmit for both apps
npm run verify           # typecheck + all tests + frontend production build
npm run test:e2e         # 31 browser tests (Playwright) against the one-process build
./scripts/verify-demo.sh # API walkthrough against a running dev stack
```

**Continuous integration.** `.github/workflows/ci.yml` runs `npm run verify` on every push and pull request, then the browser tests against the site served the way it is deployed. A failing browser run keeps its Playwright report as a build artifact.

**Browser tests** (`e2e/`, run once with `npm --prefix e2e ci`) start the one-process build over a freshly seeded database in a temporary folder — never the development database — and sign each demo account in once. Locally they use an installed Chrome; otherwise `npm --prefix e2e run install-browser` fetches Chromium. They cover the demo journeys; a whole mentorship from both sides in two browsers at once — request, accept, messages (the reply arriving live, without a reload), booking a slot, and ending it, which cancels the session and asks both for feedback; deep links surviving a reload; and the accessibility pass (DESIGN_BACKLOG #58): fourteen pages and an open conversation scanned with axe against WCAG 2.1 A/AA with no serious or critical violations allowed, signing in by keyboard alone with a visible focus ring, and a skip link past the navigation.

| Suite | Count | Covers |
|---|---|---|
| `backend/tests/access.test.ts` | 11 | the role model: verification on signup, pending accounts, capabilities per role, admin limits, suspension |
| `backend/tests/auth.test.ts` | 14 | signup, login, session rehydration, tampered tokens, equal-cost login failures |
| `backend/tests/mentorship.test.ts` | 10 | requests, capacity, idempotent accept/decline, match events |
| `backend/tests/scheduling.test.ts` | 43 | availability rules, slot generation, booking, double-booking, reschedule, held sessions, timezones |
| `backend/tests/lifecycle.test.ts` | 9 | 12-week terms, ending early, request limits, withdrawal, expiry, mid-point check-in |
| `backend/tests/phase3.test.ts` | 9 | opportunities and applicants, announcement audiences, admin events, the audit log |
| `backend/tests/quality.test.ts` | 14 | goals, session ratings, match explanations, office hours and slot blocking, board filters and deadlines, the alumni directory |
| `backend/tests/notifications.test.ts` | 12 | who is notified of what, message collapsing, reading, announcement audiences, reminders, meeting links, .ics output and folding, the live stream |
| `backend/tests/email.test.ts` | 7 | verification and reset links, single use, voiding older links, hashed storage, no account enumeration |
| `backend/tests/trust.test.ts` | 13 | consent and new terms, report and block, the reports queue, data export, account deletion and what it leaves behind, CSV parsing and alumni import |
| `backend/tests/platform.test.ts` | 8 | serving the built frontend (fallback, caching, CSP, no path escape), request ids, backups and their rotation |
| `backend/tests/visibility.test.ts` | 1 | leaving the alumni directory while staying findable as a mentor |
| `backend/tests/insights.test.ts` | 12 | re-ranking by reliability and exposure, logged ranks, supply and demand, the pipeline and outcome tables, unanswered requests, paged user lists |
| `backend/tests/account.test.ts` | 12 | renaming, password change signing out other sessions, photo upload checks and serving, admin photo removal, mentor profile editing |
| `backend/tests/recommendations.test.ts` | 4 | eligibility (capacity, existing mentors, pending requests), suggestion logging |
| `backend/tests/matchingWorker.test.ts` | 2 | worker supervision, re-priming after a crash |
| `backend/tests/slots.test.ts` | 27 | the slot arithmetic itself — window edges, overlaps, cadence, local clocks |
| `backend/tests/communities.test.ts` | 13 | visibility defaults, SQL-level filtering, creator-only toggle |
| `backend/tests/admin.test.ts` | 12 | the admin role boundary, verification review, credential exposure |
| `backend/tests/feedback.test.ts` | 10 | participant-only submission, the Tier-2 field shape, duplicates |
| `backend/tests/messaging.test.ts` | 14 | thread isolation, per-viewer authorship, unread state, who may message whom |
| `backend/tests/security.test.ts` | 7 | rate limiting, RBAC, forged cookies, injection, oversized bodies |
| `backend/tests/lib.test.ts` | 19 | time, timezone and config helpers |
| `frontend/tests/routing.test.tsx` | 5 | route guards: sign-in, role, and opt-in redirects |
| `frontend/tests/roles.test.tsx` | 10 | where each role may go, tabs as URLs, navigation built from capabilities |
| `frontend/tests/AuthPage.test.tsx` | 5 | sign-in, server errors, per-field validation, alumni verification fields |
| `frontend/tests/MentorProfilePage.test.tsx` | 3 | request, message and apply offered only to those allowed |
| `frontend/tests/AvailabilityEditor.test.tsx` | 4 | loading, saving the whole week, refused schedules |
| `frontend/tests/http.test.ts` | 5 | the HTTP client: cookies, query building, error mapping |
| `frontend/tests/useSession.test.tsx` | 3 | cached data never outlives the account that fetched it |
| `frontend/tests/AdminDashboardPage.test.tsx` | 2 | every undecided verification can still be decided |
| `frontend/tests/MessagingPage.test.tsx` | 1 | opening a specific thread by link |
| `frontend/tests/StudentDashboardPage.test.tsx` | 1 | recommendations open the recommended mentor |
| `frontend/tests/phase3.test.tsx` | 12 | ending and checking in on mentorships, suggested-mentor view, opportunities, creating communities, admin events |
| `frontend/tests/profiles.test.tsx` | 7 | avatars and their fallback, account settings, editing career goals and the mentor profile |
| `frontend/tests/emailFlows.test.tsx` | 6 | the verify, forgot and reset pages, and the verify-your-email banner |
| `frontend/tests/notifications.test.tsx` | 6 | the bell, live-update hints becoming refetches, meeting and calendar links |
| `frontend/tests/trust.test.tsx` | 7 | the consent screen, deleting an account, report and block, the reports queue, previewing an import |
| `frontend/tests/visibility.test.tsx` | 2 | the directory toggle, offered to alumni only |
| `frontend/tests/insights.test.tsx` | 3 | the Insights page and its periods, the evaluation, the server-paged user list |
| `frontend/tests/quality.test.tsx` | 9 | goals, ratings, match reasons, office hours, the board's URL filters, the directory |
| `ml-matching/.../tests/` | 43 | the matching engine (untouched by this integration), and the worker's outcome evaluation |

Backend tests run against a temporary SQLite file and drive Fastify through `.inject()` — no sockets, no port conflicts, and the same routing, validation and error path a real request takes.

Frontend tests run in jsdom with Testing Library and replace `fetch` with a fake backend (`frontend/tests/helpers/fakeApi.ts`), so the real HTTP client is exercised in every test rather than mocked away.

---

## Scripts

Run from the repository root:

| Script | What it does |
|---|---|
| `npm run dev` | Backend + frontend (and Mailpit, once set up) together, supervised |
| `npm run serve` | The site as deployed: one process serving the API and the built frontend on :3001 (`-- --rebuild` to rebuild first) |
| `npm run mail` | Set up (first time) and run Mailpit, the local email inbox at http://localhost:8025 |
| `npm run dev:backend` / `npm run dev:frontend` | Just one of them |
| `npm run dev:design` | The original Figma design export in `src/`, for visual comparison |
| `npm run setup` | Install both apps, then reset and seed the database |
| `npm run db:reset` | Drop and re-migrate the database (destructive) |
| `npm run db:seed` | Load demo accounts and the sampled ML population |
| `npm run db:backup` | Online, integrity-checked snapshot of the database; keeps the newest `BACKUP_KEEP` |
| `npm run build` | Production build of both apps |
| `npm run typecheck` | `tsc --noEmit` for both |
| `npm test` | Backend, frontend and ML suites |
| `npm run verify` | Typecheck, all tests, and the frontend build |
| `npm run test:e2e` | Browser tests (Playwright) against the one-process build over a fresh database |

---

## Configuration

`backend/.env` — copy from `backend/.env.example`. Real environment variables take precedence, so `PORT=4000 npm run dev` works without editing the file.

| Variable | Default | Notes |
|---|---|---|
| `NODE_ENV` | `development` | |
| `PORT` / `HOST` | `3001` / `127.0.0.1` | |
| `JWT_SECRET` | — | **Required**, ≥ 32 chars. No fallback. |
| `CORS_ORIGIN` | `http://localhost:5173` | The single browser origin allowed to send credentials |
| `DATABASE_PATH` | `./data/app.db` | |
| `PYTHON_BIN` | `python3` | |
| `ML_ENGINE_DIR` | `../ml-matching/MachineLearning` | |
| `ML_WORKER_ENABLED` | `true` | `false` boots the API without matching; recommendations use the fallback |
| `MAIL_TRANSPORT` | `smtp` | `smtp` sends through `SMTP_HOST`; `console` prints emails to the API log |
| `SMTP_HOST` / `SMTP_PORT` | `127.0.0.1` / `1025` | Mailpit by default; a real relay in production |
| `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` | `false`, —, — | For a real relay |
| `MAIL_FROM` | `Strathmore Alumni Connect <no-reply@alumni-connect.local>` | Sender shown on emails |
| `APP_URL` | `CORS_ORIGIN` | Public address used in emailed links |
| `SERVE_FRONTEND` | `true` in production | Serve the built frontend from the API |
| `FRONTEND_DIST` | `../frontend/dist` | Where that build is |
| `RATE_LIMIT_PER_MINUTE` | `300` | Per address, outside sign-in (fixed at 10) |
| `BACKUP_DIR` / `BACKUP_KEEP` | beside the database / `14` | For `npm run db:backup` |

`frontend/.env` — optional, from `frontend/.env.example`. Only `VITE_API_URL` (default `http://localhost:3001/api` in development and `/api`, the same origin, in a production build).

---

## Known limits

Honest about what this is: a complete, locally-runnable demo, not a deployed production system.

- **One node.** SQLite in WAL mode is right for a single API process; more than one needs Postgres, and [docs/OPERATIONS.md](docs/OPERATIONS.md) sets out the move. There are no Docker or deployment manifests; the site runs as one process (`npm run serve`) behind a TLS proxy.
- **Fixed timezone offsets.** Mentors and events choose from six African and universal timezones, each a fixed offset from UTC. That is exact for these zones, none of which observes daylight saving, but a zone that does (Europe, North America) would need real timezone data. Times show on the owner's clock, not converted to each viewer's.
- **Databases created before migration 004 should be reseeded.** Earlier builds stored availability and seeded event times as if they were UTC; the migration cannot tell which existing values were meant as local times. `npm run db:reset && npm run db:seed` gives consistent data.
- **Browser tests cover the main journeys, not every screen.** Playwright walks sign-in, recommendations, a whole mentorship (request to feedback, with messaging and booking), admin insights and the accessibility pass. Communities, events, opportunities, office hours, reporting and account deletion are covered by the API tests rather than in a browser. The accessibility pass is automated (axe) plus keyboard checks — a screen-reader walkthrough by a person is still worth doing before launch.
- **Matching is Tier 1.** Content-based scoring over encoded features, re-ranked by hand-set reliability and exposure factors. The learned re-ranker is deliberately not built: `match_events` and the feedback forms collect its training data, and it waits for real human feedback rather than synthetic labels.
- **Admins are seed-created.** There is no public path to an admin account, on purpose.
- **Email goes to a local test inbox by default.** Verification, reset and invitation emails are real SMTP, delivered to Mailpit in development; production needs a real relay configured. In-app notifications are not emailed.
- **Live updates are per process.** The event hub lives in memory, which is right for the single API process this runs as. Several processes behind a load balancer would need a shared channel (Redis pub/sub, or Postgres `LISTEN/NOTIFY` after a database move); until then, polling still delivers everything, just more slowly.
- **Privacy texts are drafts.** The privacy notice and code of conduct in the app need review by Strathmore's data protection officer before real users see them. Deletion anonymises the account row rather than removing it, and backups (none are configured) would need their own retention rule.
- **The original design export in `src/`** is kept only as a visual reference and is not part of the running app.

Design decisions taken in conversation that changed already-built parts of the project are tracked in [DESIGN_BACKLOG.md](DESIGN_BACKLOG.md), including where each was implemented.
