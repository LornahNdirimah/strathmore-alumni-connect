# Design backlog

Running list of design decisions made in conversation that affect **already-built** parts of the project but hadn't been implemented yet. Each entry is something to circle back to — not urgent, just tracked so it isn't lost. Add new entries as they come up; move an entry to "Resolved" with a short note once it's actually implemented.

---

## Open

Entries 6–19 come from the full code review of 2026-09-29; entries 20–31 from the role and dashboard audit that followed; entries 32–58 are improvement proposals. The planned order is in [ROADMAP.md](ROADMAP.md). Severity is how badly the defect hurts real use, not how hard it is to fix.

### From the code review

All resolved.

### From the role and dashboard audit

All resolved.

### Improvement proposals

Not defects: additions proposed after the audit to make the platform more useful. Each is independent unless noted.

All resolved — see *Resolved* below.

---

## Resolved

### Phase 9 — platform (2026-09-30)

- **Single origin (#53).** With `SERVE_FRONTEND` (on in production) the API serves `frontend/dist` through `@fastify/static` 10: hashed assets cached as immutable, `index.html` revalidated, and every other non-API `GET` answered with the page so deep links survive a reload. The CSP opens only as far as the page needs (its own scripts, styles and API, the landing photo). Production builds call `/api` on their own origin. `npm run serve` runs it all as one process. Checked in a real browser: the production `Secure` cookie signs in and every tested page works from one port.
- **CI and browser tests (#54).** `.github/workflows/ci.yml` runs `npm run verify`, then the Playwright suite in `e2e/` against the one-process build over a freshly seeded throwaway database (the reset script refuses production mode, so the database is prepared in development mode and served in production mode). 31 tests: journeys, a whole mentorship from both sides (request, accept, live messaging, booking, ending with feedback), deep links, the directory toggle and the accessibility pass. Writing the mentorship spec found three more accessibility gaps, now fixed: an unlabelled message box, Accept/Decline buttons that did not say whose request, and slot buttons that spoke only a time; axe on an open conversation then caught faded timestamps and report links under 4.5:1. `scripts/verify-demo.sh` is kept for now as an API-level check against a running dev stack.
- **Shared API types (#55).** `backend/src/contract/` holds wire types with no imports; the backend annotates responses with them (which at once caught a route typing `role` as a bare string) and the frontend imports them as `@contract`. Renaming a field was checked to fail both compilers. Moved so far: session and capabilities, admin users, reports, imports, insights and the evaluation; the rest follow when touched.
- **Operability (#57).** Request ids on every log line and response (a proxy's `X-Request-Id` is reused if well-formed), and in 500 bodies. `npm run db:backup` takes an online, integrity-checked, single-file snapshot and rotates to `BACKUP_KEEP`. `RATE_LIMIT_PER_MINUTE` makes the general limit configurable for proxies and test runs. [docs/OPERATIONS.md](docs/OPERATIONS.md) covers running in production, logs, backups and restore, and a step-by-step move to Postgres.
- **Accessibility (#58).** axe scans fourteen pages against WCAG 2.1 A/AA in the browser suite. It found an event-tag colour under 4.5:1 (darkened) and a messages page with no heading (given one); the pass also added a skip link, a focusable main region and a consistent focus ring in the brand green (the gold would have been about 2:1 on white). Keyboard-only sign-in is tested.
- **Directory visibility (#44, remainder).** Migration 010 adds `users.directory_visible`; *Account → Privacy* lets an alumnus leave the alumni directory while mentor search still finds their mentor profile. The setting is included in the data export.

### Phase 8 — insights and matching (2026-09-30)

- **Supply and demand (#47), pipeline (#48).** `modules/insights/insights.service.ts` counts, per track, waiting students against free seats, and follows every pair first suggested in a 30/90/365-day window to a request, acceptance, first held session and feedback (each only if it came after the suggestion). Requests are split by whether a suggestion preceded them. Shown on a new *Admin → Insights* page.
- **Outcome evaluation (#50).** Two views. From the database: take-up by match score band and by list position, which only means something if higher scores are taken up more; suggestions now log their `rank` and adjusted score so this has data from here on. From the engine: the worker gained an `evaluate` method that scores every formed mentorship with `evaluation.total_compatibility` against the `capacitated_assignment` ceiling for the same students (each mentor given at least the seats they really filled), and compares the fit of accepted and declined pairs. `GET /api/admin/insights/evaluation` is separate because it needs the worker; with the worker down it says so. On the demo data the one scorable mentorship sits at 42% of the ceiling — too little data to conclude anything yet, which is the honest state.
- **Reliability (#52) and diversity (#51).** `services/matching/rerank.ts` multiplies compatibility by a smoothed answered-share factor (floor 0.6; −10% for a typical answer slower than three days) and an exposure factor (eased down past three students shown per free seat per week), over a candidate pool three times the list length. The student still sees the matcher's compatibility as the score. The engine's own MMR diversifies within one student's list; this spreads mentors across students. Admins see the least responsive mentors on the Insights page.
- **Paging (#49).** `GET /admin/users` takes `q`, `role`, `status`, `page` and `limit` and returns a total; the page searches on the server and pages.
- **Batched listings (#18).** `loadMentorExtras` fetches skills, tracks and remaining capacity for a page of mentors in three queries instead of three per mentor; search and recommendations use it.

### Phase 7, part 2 — report and block, data protection, alumni import (2026-09-30)

Decision D8 (see [ROADMAP.md](ROADMAP.md)): deleting an account **anonymises** it. It happens at once when the password is re-entered; active mentorships are ended first, the other side told and the mentor's seat freed; the text of messages the person sent is replaced with "Message removed". Migration `009_trust_and_privacy.sql` adds the terms and deletion columns, `reports` and `user_blocks`, and rebuilds `email_tokens` to allow the `invite` purpose; it was applied to an existing seeded database with every row and reference intact.

- **Consent (#42, #44).** Signup requires accepting the privacy notice and code of conduct (`/privacy`, `/code-of-conduct`) and records the version (`lib/terms.ts`). When the version changes, `requireAuth` refuses with a clear message and the app holds the person at `/consent`; accepting, exporting, deleting and signing out still work, so someone who disagrees can leave with their data. Both texts are drafts for Strathmore's data protection officer to review.
- **Report and block (#42).** `modules/safety`: a report names a person and where it happened (profile, conversation, message) with a reason; a second open report of the same thing is refused. Blocking is checked when opening a conversation, sending a message and requesting a mentorship, in both directions. Admins get a *Reports* queue with the reported message quoted only when the reported person wrote it and a running count per person; reviewing is audited and notifies the reporter of the outcome.
- **Export (#44).** `GET /api/account/export` downloads everything held about the account as JSON, with no credentials.
- **Deletion (#44).** `account.deletion.ts` runs in one transaction: end mentorships and withdraw requests (notifying the other side), cancel future office hours (notifying attendees), remove the profile's details, skills, availability and every personal record, blank the person's message text and written feedback, and anonymise the user row to "Former member" with an unusable email and password and a bumped session version. The photo file is removed after the commit. The last admin cannot delete themselves; deleted accounts are hidden from admin lists and cannot sign in.
- **Bulk import (#46).** `POST /admin/alumni/import` parses a CSV (`lib/csv.ts`, RFC 4180 with loose header matching, 500 rows), classifies every row as ready, duplicate or invalid, and on a real run creates verified alumni with an unusable password and emails each an invitation link (7 days) to set one. The admin page previews first; nothing is created until *Import*. Imports are audited.
- **Checked live** against a copy of the demo database over real SMTP: an import's invitation arrived in Mailpit, its link set the password once (a second use was refused), the new alumnus met the consent screen, a report was reviewed and the reporter notified, a block stopped a conversation from opening, and deletion anonymised the account and freed the blocklist entry.

### Phase 7, part 1 — email verification and password reset (2026-09-30)

Development email goes to **Mailpit**, a local test inbox (decided 2026-09-30): real SMTP, delivered on this machine and shown at http://localhost:8025.

- **Mail (#43).** `backend/src/lib/mailer.ts` sends through SMTP (`nodemailer` 10, the one new dependency) with `console` and in-memory transports for no-server use and tests. Mail goes out after the request's work commits; a failure is logged, never thrown. Settings are env vars defaulting to Mailpit's ports; `APP_URL` builds the links.
- **Verification.** Migration 008 adds `users.email_verified_at` (existing and seeded accounts count as confirmed) and `email_tokens` (SHA-256 of each token only; 24-hour verify links, one-hour reset links; single use; a new link voids older ones). Signup sends the link; `/verify-email` confirms it; a banner with *Send it again* shows until then. Confirming does not block anything.
- **Password reset.** `/forgot-password` answers the same for every address; `/reset-password` sets the password, signs out every session and confirms the address.
- **Tooling.** `npm run mail` downloads Mailpit into `.tools/` from its GitHub releases, verifying the SHA-256 against the digest GitHub records before running it (the release publishes no checksums file, so a first version that expected one refused to install — safely). `npm run dev` starts it when present.
- **Found on the way:** the dev supervisor signalled the `npm run` wrappers only, leaving `tsx watch` and `vite` running with their ports held after it stopped. Children now run in their own process groups and the whole group is signalled; verified for both SIGTERM and SIGINT, with all four ports released.

Tests: `backend/tests/email.test.ts` (7), `frontend/tests/emailFlows.test.tsx` (6). Verified end to end over real SMTP: a signup's email arrived in Mailpit, its link confirmed the address, and a reset email followed. `npm run verify` passes (249 backend, 79 frontend, 40 ML), both audits report 0 vulnerabilities, and `scripts/verify-demo.sh` passes 99/99.

---

### Phase 6 — mentorship quality (2026-09-30)

Migration 007 adds `mentorship_goals`, `session_ratings`, `office_hours` and `office_hour_bookings`.

- **Goals (#32).** Up to five per mentorship, added, completed or removed by either participant; returned on each relationship and shown on the mentorship card.
- **Per-session ratings (#33).** `POST /api/scheduling/sessions/:id/rating`, 1–5 plus an optional comment, participants only, once each, and only for a session marked held. Sessions carry the viewer's `myRating`.
- **Match explanations (#37).** `backend/src/services/matching/explain.ts` returns up to three literal overlaps (track, major, shared skills, shared hobbies, county or country) as `matchReasons` on each recommendation; a skill that merely repeats the track is not listed twice. Checked against the ML path with the seeded population.
- **Office hours (#36).** `/api/office-hours`: mentors publish a time on their own clock with a capacity; any student joins; the meeting link is revealed on joining; the host cancels and attendees are notified. Office hours are unioned into both sides' commitments, so one-to-one slots at that time disappear — checked live: an office hour at 17:00 removed exactly the 17:00 and 17:30 slots.
- **Opportunities board (#38).** `/opportunities` page with URL-held search and type filters, deadlines and apply; the feed endpoint takes `q` (wildcards matched literally) and `type`; posters set a closing date that ends at midnight EAT.
- **Alumni directory (#41).** `GET /api/alumni` and `/alumni-directory`, gated by a new `alumni.directory` capability: verified, active alumni only, never emails, with class-year and industry filters built from well-formed years. Seeded verification entries now store the year alone, as signup does.

Tests: `backend/tests/quality.test.ts` (14), `frontend/tests/quality.test.tsx` (9). `npm run verify` passes (242 backend, 73 frontend, 40 ML) and `scripts/verify-demo.sh` passes 99/99 on a fresh database.

---

### Phase 5 — notifications and live updates (2026-09-29)

- **In-app notifications (#26).** Migration 006 adds `notifications` (per-person rows with a link and read state). `notify()` in `backend/src/lib/notifications.ts` is called inside the transaction of each action: requests received / answered / withdrawn / expired, mentorships ended, sessions booked / moved / cancelled by the other side, messages (collapsed to one unread notification per conversation via `group_key`, and cleared when the thread is read), verification decisions, announcements, cancelled events for registrants, applications to an opportunity, and removed communities. A bell in the top bar — kept visible on phones — lists them, marks them read and follows their links. *Deviation from the plan:* announcements are copied to each recipient with one `INSERT … SELECT` rather than merged in at read time, so every notification has the same per-person read state; at ~1,200 recipients that is a single fast statement.
- **Session reminders (#40).** The lifecycle sweep, now every 15 minutes, reminds both participants of any session starting within 24 hours, once (`sessions.reminder_sent_at`); moving a session clears the flag so the new time is reminded too.
- **Meeting links and calendar export (#39).** Sessions carry an optional `meeting_link` (http(s) only, validated server-side), set when booking or later from the session list. `GET /api/scheduling/sessions/:id/calendar.ics` (participants only) and `GET /api/events/:id/calendar.ics` return RFC 5545 files built by `backend/src/lib/ics.ts`, with text escaping and 75-octet folding that never splits a multi-byte character.
- **Live updates (#56).** `GET /api/notifications/stream` is a server-sent-events stream carrying hints only; `frontend/src/app/useLiveUpdates.ts` turns them into query invalidations. It replays the CORS headers the hijacked response would otherwise lose, sends a heartbeat, and ends open streams on shutdown. Messaging polling dropped to a 20–60 s fallback. The hub is in-process — noted under Known limits in the README.

Tests: `backend/tests/notifications.test.ts` (12, including the stream over a real socket) and `frontend/tests/notifications.test.tsx` (6). `npm run verify` passes (228 backend, 64 frontend, 40 ML) and `scripts/verify-demo.sh` passes 99/99; the walkthrough's own actions produced the expected notifications on both sides, and the stream's CORS headers were checked from the frontend's origin.

---

### Phase 4 — profiles and photos (2026-09-29)

Decision D6 from [ROADMAP.md](ROADMAP.md) was taken as proposed: photos are optional, and admins can remove one.

- **Editable profiles for every role (#24).** Each Profile tab starts with *Account settings* (`frontend/src/features/account/AccountSettings.tsx`): name, password, photo. Students then edit their career goals and mentors their full mentor profile, reusing the onboarding forms (`StudentForm`, `MentorForm`, now exported with an `initial` value). `PATCH /api/mentors/me` now also saves the matching-engine fields (major, hobbies, unique quality, country, region), and `GET /api/mentors/me` returns an `editable` object with every stored field — kept off the public profile, since hobbies and home region are matching inputs rather than profile content. The capacity-only editor was folded into the form. Found on the way: the mentor-join form kept hobbies and "something distinctive" in its state but never rendered inputs for them, so every mentor who joined through the form was matched with them empty; both now have inputs.
- **Password changes sign out other devices.** Migration 005 adds `users.session_version`; tokens carry the version they were issued at and the auth guard refuses a stale one. `POST /api/account/password` checks the current password, bumps the version and re-issues this device's cookie.
- **Profile photos (#25, D6).** The browser centre-crops and scales a photo to 256×256 WebP/JPEG (`frontend/src/lib/image.ts`) and uploads it as a data URL, so no multipart or image-decoding dependency was added. The server (`backend/src/lib/avatars.ts`) reads the type from the file's leading bytes (JPEG, PNG, WebP only, and it must match the declared type), caps it at 300 KB, generates the file name, and stores it beside the database. `GET /api/users/:id/avatar` serves it to signed-in users with `Cross-Origin-Resource-Policy: same-site` — Helmet's default would have blocked the image on the frontend's port — and a versioned URL so it can be cached hard. `avatarUrl` is on the session, mentor summaries, relationships, requests, conversations and the admin user list, and an `Avatar` component shows it everywhere, falling back to initials. Admins remove a photo from the Users tab; it is audited as `avatar.removed`.

Tests: `backend/tests/account.test.ts` (12), `frontend/tests/profiles.test.tsx` (7). `npm run verify` passes (216 backend, 58 frontend, 40 ML) and `scripts/verify-demo.sh` passes 99/99 on a fresh database. Upload, serving headers and the other-device sign-out were checked against a live API. *Not yet checked in a real browser:* the canvas resize in `lib/image.ts`, which jsdom cannot run — its output format is detected rather than assumed, but it has only been exercised through a mock.

---

### Phase 3 — missing actions and the mentorship lifecycle (2026-09-29)

Decisions D3, D5 and D7 from [ROADMAP.md](ROADMAP.md) were taken as proposed. Migration `004_lifecycle_and_admin.sql` rebuilds two tables, so the migration runner gained a `-- migrate: foreign_keys=off` directive that switches enforcement off around the file and runs `PRAGMA foreign_key_check` before committing (`backend/src/db/migrate.ts`). It was applied to a seeded database with every row and reference intact.

- **Mentorships can end (#7, #34, D3).** Each mentorship has a 12-week term (`ends_on`, backfilled for existing rows). Either participant can end it early with an optional reason; ending frees the seat, cancels sessions that have not happened, keeps the thread, and prompts feedback. An hourly in-process sweep (`backend/src/plugins/lifecycle.ts`) closes mentorships whose term has run out. At the halfway point each side is asked for a check-in — on track / needs attention plus a note (`relationship_checkins`). A student cannot re-request a mentor they have already finished with.
- **Request limits and expiry (#35).** At most three pending requests per student; unanswered requests become `expired` after seven days (a new status, hence the table rebuild), and students can withdraw a pending request.
- **Timezones (#11, D7).** `lib/time.ts` maps each supported label (EAT, CAT, SAST, WAT, GMT, UTC) to a fixed offset. Availability windows are wall-clock times in the mentor's timezone; `generateSlots` and `isSlotAligned` convert them to UTC instants, and every formatter shows times on the owner's clock. The availability form's free-text label became a select; the seed stores its events' real instants. *Databases from before migration 004 should be reseeded.*
- **Opportunities owned by alumni (#29 part, D5).** `mentor_opportunities.posted_by_user_id` replaces the required mentor link; any verified alumnus can post (`opportunities.post`). New `/api/opportunities` routes: feed, mine, post, close, applicants, apply. Students see a feed on their dashboard; posters see applicants' names, emails and notes.
- **Mentor-side actions (#29).** The alumni *My mentees* tab shows a card per mentee with Message, Book a session, End and the check-in; mentors are now asked for feedback too; *Availability* lists past sessions so they can be marked held.
- **Announcements (#22).** `GET /api/announcements` returns what was sent to everyone plus the caller's role; students and alumni see it on their overview, admins see the history under *Announcements*.
- **Admin events (#23).** Admins schedule (on a wall clock in a chosen timezone), edit and cancel events and list attendees (`events.manage`). A cancelled event stays listed, marked, and cannot be registered for; registration also closes once an event has started.
- **Communities (#27).** Alumni can start a community from the communities page, alumni-only by default or open to students.
- **Suggested mentors (#28).** Mentor search keeps every filter in the URL, exposes the track filter, and has a *Suggested for me* view (`/mentors?view=suggested`) that the dashboard links to.
- **Audit log (#45).** `admin_audit` records verification decisions, suspensions, announcements, event changes and community removals, written in the same transaction as the action (`backend/src/lib/audit.ts`); admins see it under *Activity log*.

Tests: `backend/tests/lifecycle.test.ts` (9), `backend/tests/phase3.test.ts` (9), new timezone tests in `lib`, `slots` and `scheduling`; `frontend/tests/phase3.test.tsx` (12). Two time-formatting tests that pinned the old UTC-labelled-EAT behaviour were corrected. `npm run verify` passes (204 backend, 51 frontend, 40 ML) and `scripts/verify-demo.sh` passes 99/99 on a fresh database; event times, slot times, ending a mentorship, announcements and the opportunities feed were also checked against a live API.

---

### Phase 2 — the role model (2026-09-29)

Decisions D1, D2 and D4 from [ROADMAP.md](ROADMAP.md) were taken as proposed.

- **One policy for both sides (#21).** `backend/src/lib/policy.ts` defines each role's capabilities. Routes guard with `app.requireCapability(...)`; `/auth/me`, login and signup return the caller's `capabilities`; the frontend builds the top bar (`navLinksFor`), sidebar (`sidebarItemsFor`), route guards and buttons from that list (`frontend/src/app/SessionContext.tsx`, `useCan`). Admins now have no mentor directory, mentorship, sessions, feedback, messaging, event registration or community membership — in the API as well as the UI. *Where:* `backend/src/lib/policy.ts`, `backend/src/plugins/auth.ts`, every `*.routes.ts`, `frontend/src/config/navigation.ts`, `frontend/src/App.tsx`.
- **Community moderation (D1).** `DELETE /api/groups/:id` removes a group; only admins hold `communities.moderate` — not even the creator. The communities page shows admins "Remove group" instead of "Join".
- **Who may message whom (#19, D2).** A student and an alumnus may open a thread once they share a mentorship or an open request; alumni may message each other; students may not message students; admins have no messaging and cannot be messaged. Checked when a thread is opened, so existing threads stay readable. *Where:* `assertMayConverse` in `backend/src/modules/messaging/messaging.service.ts`.
- **Verification that works for real signups (#6, D4).** Alumni signup requires a class year and programme and creates the queue entry in the same transaction. A pending account has no capabilities: `/auth/me` still answers (via `requireSession`) with its verification status, and the app shows a waiting screen (`PendingVerificationPage`). Pending and suspended accounts are excluded from search and matching. Approval activates only a *pending* account, so it cannot lift a suspension.
- **Mentoring optional for alumni (#20).** The route guard no longer requires a mentor profile for alumni. A non-mentor alumnus gets a full dashboard with a "Become a mentor" card; mentor tabs (My Mentees, Availability, Opportunities) appear once they hold `mentorship.mentor`.
- **Suspension (#12).** `PATCH /api/admin/users/:id/status` suspends or reactivates non-admin accounts; the admin "Users" tab lists everyone with search, a role filter, and Suspend / Reactivate. Every request re-reads role and status from the database, so a suspension signs the user out on their next request.
- **Dashboard tabs are URLs (#31).** `/student/my-sessions`, `/alumni/availability`, `/admin/users`. Unknown or disallowed tabs fall back to the overview; shortcut tabs go to their page.

Tests: `backend/tests/access.test.ts` (11) and five new messaging tests; `frontend/tests/roles.test.tsx` (10), `frontend/tests/MentorProfilePage.test.tsx` (3), two new signup tests. The frontend's async wait timeout was raised to 5 s after lazy-loaded route tests proved flaky under load. `npm run verify` passes (178 backend, 39 frontend, 40 ML) and `scripts/verify-demo.sh` passes 99/99 on a freshly seeded database; the verification, messaging and suspension rules were also exercised live.

---

### Phase 1 fixes (from the 2026-09-29 review)

Defects that needed no product decision. Each has a regression test that fails without the fix.

- **#8 — Cached data outlived the account that fetched it.** `useSession` clears the query cache whenever the signed-in identity changes (login, logout, a different account) and keeps it when the same account re-reads its session, as onboarding does. The dashboard tab also resets on logout. *Where:* `frontend/src/app/useSession.ts`, `frontend/src/App.tsx`; `frontend/tests/useSession.test.tsx`.
- **#9 — The matching worker was not re-primed after a restart.** `MatchingWorker.onReady` runs its listeners on every start, and the plugin rebuilds the index there. Verified live by killing the worker: it restarted and the index was rebuilt with all 304 mentors. *Where:* `backend/src/services/matching/MatchingWorker.ts`, `backend/src/plugins/matching.ts`; `backend/tests/matchingWorker.test.ts`, using a fake worker in `backend/tests/fixtures/fake-worker/`.
- **#10 — Login timing revealed registered emails.** The unknown-account path compares against a real decoy hash made once, so both paths pay a full scrypt derivation. *Where:* `backend/src/modules/auth/auth.service.ts`; `backend/tests/auth.test.ts`.
- **#13 — Recommendations included existing mentors, and every page load re-logged them.** Mentors the student has a mentorship or pending request with get zero seats for that query, which removes them from both the ML ranking and the fallback (checked live against the ML path). A "suggested" event is logged once per mentor per student per 24 hours. *Where:* `backend/src/services/matching/matching.service.ts`, `backend/src/modules/mentors/mentors.routes.ts`; `backend/tests/recommendations.test.ts`.
- **#14 — `.env.example` was git-ignored.** `!.env.example` added to `.gitignore`.
- **#15 — Stale lists and no message refresh.** Sending a request refreshes the request list and stats. "Message" refreshes the conversation list and opens *that* thread via `/messages?c=<id>` — previously it opened whichever thread was most recent. The messaging page polls: the open thread every 5 s, the list every 15 s. *Where:* `frontend/src/features/mentors/MentorProfilePage.tsx`, `frontend/src/features/messaging/MessagingPage.tsx`; `frontend/tests/MessagingPage.test.tsx`.
- **#16 — `scheduledAt` was stored unnormalised.** Session times and requested slots are normalised to `toISOString()` form at validation, so formatting cannot sidestep the double-booking indexes. *Where:* `isoInstant` in `backend/src/modules/scheduling/scheduling.schemas.ts`, used by `backend/src/modules/mentorship/mentorship.schemas.ts`.
- **#17 — Session-status loopholes.** "Completed" is checked against the time the session will have after the update; a held session cannot be moved, reopened or cancelled (title and notes stay editable); a session whose time has passed cannot be rescheduled, matching the UI's `canModify`. *Where:* `backend/src/modules/scheduling/scheduling.service.ts`; `backend/tests/scheduling.test.ts`.
- **#18, matching half — N+1 queries in recommendations.** Capacity and tracks are loaded for all mentors in one query each. The unused `getRemainingCapacityMap`, which silently skipped every mentor created through the join form, was replaced by `getRemainingCapacityById` and `getTracksById`. *Where:* `backend/src/modules/mentors/mentors.repository.ts`.
- **#28, first half — "View" on a recommendation opened the general search.** It now opens that mentor's profile. *Where:* `frontend/src/features/students/StudentDashboardPage.tsx`; `frontend/tests/StudentDashboardPage.test.tsx`.
- **#30 — Flagged verifications were a dead end.** Flagged entries keep Verify and gain Reject; pending entries also offer Reject. *Where:* `frontend/src/features/admin/AdminDashboardPage.tsx`; `frontend/tests/AdminDashboardPage.test.tsx`.

After these, `npm run verify` passes (162 backend, 24 frontend, 40 ML tests) and `scripts/verify-demo.sh` passes 99/99 against a freshly seeded database.

---

### 1. Community visibility must be creator-controlled, not role-gated

**Resolved.** `groups.visibility` is a real column (`'alumni-only' | 'open-to-students'`) defaulting to `alumni-only`, and the rule is enforced in three places rather than one:

- **In SQL.** `communities.service.ts`'s `visibilityClause` filters the listing by role, so a student's query cannot return an alumni-only group in the first place.
- **On the detail route.** `getGroup` re-checks visibility, so a student who guesses or is given a group id gets a 404 rather than the group. Filtering only the list would have left the id as all an attacker needed.
- **On the mutation.** `setVisibility` throws `ForbiddenError` unless `created_by === userId`.

The open question about admin override was resolved as **no**: an admin gets 403 on the visibility route like anyone else, since "strictly tied to the creator" reads as ownership, not moderation. Platform staff can still see every group.

The API returns `canEditVisibility` per group so the UI shows the toggle only to the creator — an affordance on top of the server check, not instead of it.

*Where:* `backend/src/db/migrations/001_init.sql`, `backend/src/modules/communities/`, `frontend/src/features/communities/`. Covered by `backend/tests/communities.test.ts` (13 tests) and the live walkthrough.

---

### 2. Mentor capacity should be self-reported per mentor, not a global constant

**Resolved.** `mentor_profiles.capacity` is set by the alumnus on the mentor-join form (see #3) and validated on the way in.

The important correction beyond simply adding the column: **remaining capacity is derived, never stored.** It is computed as `capacity − COUNT(active relationships)` at read time, so it cannot drift out of step with reality the way a decremented counter can. Accepting a request consumes a slot because the relationship row exists, not because a number was edited. Lowering capacity below the number of active commitments is refused.

The matching engine already read per-mentor capacity; it is now passed the live remaining-capacity map from the database on every call, so the database stays the single authority on who is full.

*Where:* `backend/src/modules/mentors/`, `backend/src/modules/mentorship/mentorship.service.ts`, `backend/src/services/matching/`. Covered by `backend/tests/mentorship.test.ts`.

---

### 3. Mentorship access should be opt-in gated, not implicit for every account

**Resolved.** Two records exist independently of the base account: `mentorship_seekers` for students (created by the career-goals form) and `mentor_profiles` for alumni (created by the mentor-join form). Presence of the record — not the account's role — is the access gate.

`GET /auth/me` reports opt-in status alongside the session, and the frontend's route guards use it: a signed-in student without a seeker record is redirected to `/onboarding` rather than into a dashboard with nothing in it. Community membership stays independent of both, as decided.

*Where:* `backend/src/modules/seekers/`, `backend/src/modules/mentors/`, `frontend/src/app/useSession.ts`, `frontend/src/App.tsx`, `frontend/src/features/onboarding/OnboardingPage.tsx`.

---

### 4. Match-suggestion and accept/decline events aren't logged anywhere

**Resolved.** `match_events` mirrors `matching_engine.events.MatchEvent` (`event_type`, `student_user_id`, `mentor_profile_id`, `occurred_at`, JSON metadata) and records suggestions shown, requests sent, and accept/decline outcomes.

Accept in particular is written inside a single transaction with the guarded status update and the relationship insert, so the log cannot disagree with the state it describes. The status update uses `WHERE id = ? AND status = 'pending'` and checks the affected row count, which makes responding twice a 409 rather than a second event and a second relationship.

The event count is surfaced on the admin stats endpoint, so the log is visibly accumulating during a demo.

*Where:* `backend/src/db/migrations/001_init.sql`, `backend/src/modules/mentorship/mentorship.service.ts`.

---

### 5. Build the real opt-in and feedback forms

**Resolved.** All three forms exist and write to the schema the ML engine expects:

- **Student career-goals form** — major, year, target track, cadence, format, requested support, career-goal text, interests, skills. Replaces `synthesize_student_fields` for anyone who signs up for real.
- **Alumni mentor-join form** — capacity, tracks, availability, industry, company, location, plus the fields the feature encoder needs (major, hobbies, unique quality, country, state/province). Without those last ones a mentor could be stored but never vectorised, so they are part of the form rather than an afterthought.
- **Post-match feedback form** — field for field with `matching_engine.feedback_schema.FeedbackForm`: satisfaction rating, would-match-again, sessions held, relationship status, goal progress, free text.

The constraint that **feedback is human-entered and never generated** is honoured structurally, not just by convention: the only way a `feedback` row is created is a participant submitting the form, each participant may answer once (a duplicate is a 409), and non-participants get 403. Nothing in the seed or anywhere else writes feedback. Tier-2 training therefore waits on real responses, as agreed.

*Where:* `frontend/src/features/onboarding/OnboardingPage.tsx`, `frontend/src/features/feedback/FeedbackForm.tsx`, `backend/src/modules/feedback/`, `backend/src/modules/seekers/`, `backend/src/modules/mentors/`. Covered by `backend/tests/feedback.test.ts` (10 tests).

---

## Notes from the build

Several things worth recording because they were not in the original backlog but changed already-built code:

- **Sessions became real appointments.** The first build stored `sessions.scheduled_at` as a proper ISO timestamp but nothing in the UI ever created one, and a mentorship request carried its preferred time as free text (`'Wednesday 5:30 PM'`) that nothing could validate and nothing acted on. Mentors now publish recurring weekly availability (`mentor_availability`), bookable slots are derived from it minus both participants' existing commitments, and a booking must land on a slot the mentor actually offered. Requests name a real slot, and accepting one books it as the first session. Booking, rescheduling and cancelling are available for the whole life of a mentorship rather than only at request time. See the Scheduling section of [README.md](README.md).

- **Login and signup returned a narrower user object than `/auth/me`.** Only `/auth/me` carried `optIn`, but the client's route guard reads `session.optIn` to choose between a dashboard and the onboarding form — so the guard threw on `undefined` the moment a dashboard rendered after signing in, React unmounted the tree, and the app blanked. Reloading appeared to fix it because the boot path *does* call `/auth/me`. All three endpoints now answer with one session shape, the guard reads defensively, and a top-level error boundary means a future render failure shows a message rather than a blank page.

- **A conversation's creator was marked as having read messages that did not exist yet.** `openConversation` stamped `last_read_at` at creation, and unread is counted with a strict `created_at > last_read_at`, so the first reply sent in that same millisecond was silently counted as read. It surfaced as an intermittently failing test, which is how it had gone unnoticed. `last_read_at` now starts null, and marking a thread read records the newest message's timestamp rather than wall-clock now — so a message arriving between the reader opening the thread and the write landing stays unread.

- **The mock's three colliding ID conventions are gone.** `Mentor.id` was a number, `AuthSession.id` a string like `'alumni-001'`, and group members plain name strings — which forced the alumni dashboard to join an alumnus to their mentor row by *display-name equality*, so two people with the same name would have collided. Every id is now TEXT with real foreign keys.

- **Timestamps are stored as ISO 8601, not display text.** The mock stored `'October 15, 2026'`, `'10:32 AM'` and `'Yesterday'`, none of which sort or compare; "upcoming events" could not be expressed as a query. Storage is now sortable and all display formatting happens in one serializer layer.
