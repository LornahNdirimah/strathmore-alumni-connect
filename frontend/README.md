# Strathmore Alumni Connect — Frontend

The React + TypeScript single-page app for the mentorship platform. It talks to the Fastify API in [`../backend`](../backend); see the [root README](../README.md) for the whole system, architecture and demo walkthrough.

> **This app needs the backend running.** It previously shipped a self-contained mock data layer (`src/data/mockDb.ts`) and was clickable on its own. That is gone: the mock kept demo passwords in plaintext inside the JS bundle and held the session as an editable `localStorage` blob, so any visitor could grant themselves admin. All data now comes from the API over `fetch` with an httpOnly session cookie. Start both together from the repository root with `npm run dev`.

![Landing page](docs/screenshots/landing-desktop.png)

## Features

- **Landing page** — hero, "How it works", a side-by-side breakdown of mentorship benefits for students and collaboration benefits for alumni, featured mentors, success stories, and career focus areas. Copy comes from `GET /content/landing`, so it is editable without a rebuild.
- **Authentication** — login and signup with role selection, one-click demo-account fill, and an async session bootstrap. The session lives in an httpOnly cookie the app cannot read; on load it asks `GET /auth/me` who it is talking to and shows a loading gate until that resolves. Signing in routes straight to the right dashboard.
- **Onboarding (opt-in) forms** — the student career-goals form and the alumni mentor-join form. Submitting one is what grants access to the mentorship system; a signed-in account without the matching record is routed here rather than into an empty dashboard.
- **Mentor directory & profiles** — search and filters (name, company, skill, industry, availability) run server-side with pagination, so the client never downloads the whole mentor table. Profiles show the career timeline, certifications, and posted opportunities.
- **Recommendations** — the student dashboard's "Recommended for you" panel is live output from the matching engine with a score per mentor. If the matching worker is still warming up, the panel says so and shows the simpler fallback ranking instead of an empty state.
- **Role-based dashboards** — student, alumni, and admin, each with its own sidebar, quick actions, and tabs:
  - *Student:* overview, my mentors, find mentors, my sessions, profile.
  - *Alumni:* overview, my mentees, collaboration groups, opportunities, profile.
  - *Admin:* overview, verification queue, alumni management, profile.
- **Mentorship requests** — students send them naming a real slot from the mentor's published availability, alumni accept or decline from an inbox, and remaining capacity updates from the server rather than being guessed at locally. Accepting books the requested time as the first session.
- **Availability and booking** — mentors publish weekly availability windows and a session length; students pick from the concrete slots that generates. Sessions can be booked at any point in a mentorship, rescheduled onto another open slot, cancelled, or marked as held. Everything the picker offers is genuinely free, because the server removes both people's existing commitments before returning slots.
- **Feedback form** — mirrors the ML engine's feedback schema field for field, offered for each mentorship the viewer has not yet reviewed.
- **Messaging** — conversation list and thread with sending. Authorship is rendered from the viewer's own perspective, and opening a thread clears its unread badge.
- **Communities** — collaboration groups with join/leave and a detail view. The visibility toggle appears only for a group's creator, backed by the server's own check.
- **Events** — listing with type filtering (in-person / online / hybrid) and registration.
- **Responsive design** — a collapsible mobile navigation and layouts checked at desktop and mobile viewports.

## Screenshots

| | |
|---|---|
| ![Mentor search](docs/screenshots/mentor-search.png)<br>Mentor search | ![Mentor profile](docs/screenshots/mentor-profile.png)<br>Mentor profile |
| ![Student dashboard](docs/screenshots/student-dashboard.png)<br>Student dashboard | ![Admin dashboard](docs/screenshots/admin-dashboard.png)<br>Admin dashboard |
| ![Messaging](docs/screenshots/messaging.png)<br>Messaging | ![Communities](docs/screenshots/communities.png)<br>Communities |
| ![Events](docs/screenshots/events.png)<br>Events | ![Sign in](docs/screenshots/auth.png)<br>Sign in |

<details>
<summary>Mobile view</summary>

![Landing page on mobile](docs/screenshots/landing-mobile.png)

</details>

## Tech stack

- [React 19](https://react.dev/) + TypeScript (strict)
- [React Router v7](https://reactrouter.com/) for routing
- [TanStack Query v5](https://tanstack.com/query) for server state — loading, error and refetch handling in one place instead of hand-rolled across a dozen pages
- [Vite](https://vitejs.dev/) for dev server and build
- Plain CSS with design tokens (no Tailwind or UI kit) — see [`src/index.css`](src/index.css)
- Hand-rolled inline SVG icon set — see [`src/components/ui/Icon.tsx`](src/components/ui/Icon.tsx)

## Getting started

From the repository root (recommended — starts the API too):

```bash
npm run dev
```

Or this app alone, against a backend already running on `:3001`:

```bash
npm install
npm run dev        # http://localhost:5173
```

Other scripts:

```bash
npm run build      # production build to dist/
npm run preview    # serve the production build locally
npx tsc --noEmit   # typecheck
```

### Configuration

Optional. Copy `.env.example` to `.env` to point at a different API:

```ini
VITE_API_URL=http://localhost:3001/api
```

The backend's `CORS_ORIGIN` must match wherever this app is served from, since the session cookie is sent with credentials.

## Demo accounts

Seeded by the backend (`npm run db:seed` at the root). The sign-in page has one-click fill buttons.

| Role    | Email              | Password     |
|---------|--------------------|--------------|
| Student | student@demo.com   | Student123!  |
| Alumni  | alumni@demo.com    | Alumni123!   |
| Admin   | admin@demo.com     | Admin123!    |

These are seeded as real scrypt hashes. No password is present anywhere in this app's source or bundle.

## Project structure

```text
src/
├── app/
│   ├── AppLayout.tsx       # Shell: topbar, sidebar, footer
│   └── useSession.ts       # Async session bootstrap (loading | authenticated | anonymous)
├── components/
│   ├── layout/             # TopBar, Sidebar, Footer
│   └── ui/                 # Icon set, StatCard, QueryState
├── config/
│   └── navigation.ts       # Sidebar menus, nav links, quick actions, option lists
├── data/
│   └── institution.ts      # Branding (name, motto, mission) — one file to white-label
├── features/
│   ├── landing/            # Public landing page
│   ├── auth/               # Login and signup
│   ├── onboarding/         # Career-goals and mentor-join forms
│   ├── scheduling/         # Availability editor, slot picker, session list
│   ├── mentors/            # Mentor search and profile
│   ├── students/ alumni/ admin/   # Role dashboards
│   ├── messaging/          # Conversations and chat
│   ├── communities/        # Collaboration groups
│   ├── events/             # Event listing
│   └── feedback/           # Post-match feedback form
├── lib/
│   ├── http.ts             # fetch wrapper: credentials, ApiError, field-level errors
│   └── api.ts              # Typed API modules, one per backend domain
└── types/                  # The API contract as this client sees it
```

`lib/api.ts` is split by domain — `authApi`, `mentorsApi`, `seekersApi`, `mentorshipApi`, `schedulingApi`, `feedbackApi`, `groupsApi`, `messagingApi`, `eventsApi`, `adminApi`, `contentApi` — each a thin typed wrapper over `lib/http.ts`, which sends `credentials: 'include'` and turns a non-2xx response into an `ApiError` carrying the server's per-field validation messages so forms can show them inline.

## Notes on current state

There are no automated tests in this app. It is covered by `tsc --noEmit`, a production build, and the repository-level [`scripts/verify-demo.sh`](../scripts/verify-demo.sh), which drives the full demo path through the API. Component and browser tests would be the next thing to add.

A top-level [`ErrorBoundary`](src/components/ErrorBoundary.tsx) wraps the app. React unmounts the whole tree when a render throws and nothing catches it, which presents to the user as a blank page with no explanation and no way forward but a reload — so a render error now shows a readable message and a way back instead.

Branding is centralised in [`src/data/institution.ts`](src/data/institution.ts), so the platform can be adapted for another institution with a single-file change.
