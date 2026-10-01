# Roadmap

The order in which the open entries in [DESIGN_BACKLOG.md](DESIGN_BACKLOG.md) are being worked through. Numbers (`#8`) refer to backlog entries. An entry moves to the backlog's *Resolved* section, with where it was implemented, once it ships.

Phases are ordered by dependency, not by size: each one builds on what the earlier ones make possible. Every phase ends with `npm run verify` green and the README updated where behaviour changed.

---

## Decisions that gate later phases

Phases 1 and 9 need none of these. Where a phase depends on one, the proposed default is noted; work proceeds on the default unless it is changed.

| # | Question | Proposed default | Gates |
|---|---|---|---|
| D1 | Can admins see or moderate communities? | **Confirmed:** see and remove groups; never join | Phase 2 |
| D2 | Who may message whom? | **Confirmed:** only within a mentorship (or an open request); alumni may also message alumni; admins none | Phase 2 |
| D3 | Who may end a mentorship, and does ending prompt feedback? | **Confirmed:** either side; ending prompts feedback | Phase 3 |
| D4 | What can an unverified alumnus do? | **Confirmed:** a "waiting for verification" screen only | Phase 2 |
| D5 | Can alumni who do not mentor post opportunities? | **Confirmed:** yes — opportunities belong to the alumnus, not the mentor profile | Phase 3 |
| D6 | Are profile photos optional, and can admins remove them? | **Confirmed:** optional; admins can remove | Phase 4 |
| D7 | Is a fixed offset per timezone label enough? | **Confirmed:** yes, for a single-region deployment | Phase 3 |
| D8 | How is an account deleted? | **Confirmed:** anonymise, at once after the password; end active mentorships first; message text becomes "Message removed" | Phase 7 |

---

## Phase 1 — Correctness fixes ✅ done

Defects that need no product decision. Small, contained, each with a test. Shipped 2026-09-29; details under "Phase 1 fixes" in the backlog's *Resolved* section. #18 and #28 were fixed in part, and their remainders move to Phases 8 and 3.

- #8 clear the query cache when the signed-in user changes
- #9 rebuild the matching index every time the worker becomes ready
- #14 stop ignoring `.env.example`
- #15 missing cache invalidations; poll messages while the page is open
- #16 normalise `scheduledAt` before it is stored
- #17 close the session-status loopholes
- #18 remove the N+1 capacity queries in matching
- #10 make the unknown-account login path pay the full hash cost
- #13 exclude connected mentors from recommendations; stop re-logging identical suggestions
- #28 (first half) "View" on a recommendation opens that mentor's profile
- #30 flagged verifications can still be approved or rejected

## Phase 2 — Role model and access ✅ done

One policy, enforced by the API and read by the UI. Shipped 2026-09-29; details under "Phase 2" in the backlog's *Resolved* section.

- A single policy module on the backend; `/auth/me` returns the caller's capabilities; top bar, sidebar and buttons are built from them (#21, #19 via D2, D1)
- Mentoring optional for alumni (#20)
- Verification that works for real signups: queue entry on signup, class year and programme collected, `pending` accounts restricted (#6, D4)
- Suspension an admin can apply, checked on every request (#12)
- Dashboard tabs as URLs (#31)

## Phase 3 — Missing actions and lifecycle ✅ done

Shipped 2026-09-29; details under "Phase 3" in the backlog's *Resolved* section.

Actions the API supports or should support, surfaced on the right dashboard.

- Announcements readable by their audience; admin history (#22)
- Admin event management and attendee lists (#23)
- Create a community (#27)
- Mentee-side actions for mentors: applicants, booking, messaging, past sessions, feedback (#29, D5)
- End a mentorship, withdraw a request (#7, D3)
- Fixed-length mentorships, request limits and expiry (#34, #35)
- "Suggested for me" view of mentor search with URL-held filters (#28)
- Timezone offsets (#11, D7)
- Admin audit log (#45)

## Phase 4 — Profiles ✅ done

Shipped 2026-09-29; details under "Phase 4" in the backlog's *Resolved* section.

- Editable profiles for every role, reusing the onboarding forms; name and password changes (#24)
- Profile photos (#25, D6)

## Phase 5 — Notifications and communication ✅ done

Shipped 2026-09-29; details under "Phase 5" in the backlog's *Resolved* section.

- In-app notifications with an unread badge (#26)
- Session reminders (#40)
- Calendar export and meeting links (#39)
- Live updates over server-sent events (#56)

## Phase 6 — Mentorship quality ✅ done

Shipped 2026-09-30; details under "Phase 6" in the backlog's *Resolved* section.

- Goals and progress (#32)
- Per-session feedback (#33)
- Match explanations (#37)
- Office hours (#36)
- Opportunities board (#38)
- Alumni directory (#41)

## Phase 7 — Trust and accounts ✅ done

Shipped 2026-09-30; details under "Phase 7" in the backlog's *Resolved* section. Email delivers to Mailpit in development. Profile visibility settings, the remainder of #44, move to Phase 9.

- Email verification and password reset (#43)
- Report, block, code of conduct (#42)
- Data protection controls (#44)
- Bulk alumni import (#46)

## Phase 8 — Insights and matching ✅ done

Shipped 2026-09-30; details under "Phase 8" in the backlog's *Resolved* section.

- Supply and demand by track (#47)
- Pipeline metrics (#48)
- Server-side paging for admin lists (#49)
- Batch the per-mentor queries in directory listings (#18, remainder)
- Offline evaluation on real outcomes (#50)
- Recommendation diversity (#51)
- Reliability signal (#52)

## Phase 9 — Platform ✅ done

Shipped 2026-09-30; details under "Phase 9" in the backlog's *Resolved* section. Every phase on this roadmap is now done.

Independent of the rest; can be picked up at any point.

- Profile visibility settings (#44, remainder)
- Single origin in production (#53)
- CI and Playwright (#54)
- Shared API types (#55)
- Operability (#57)
- Accessibility pass (#58)
