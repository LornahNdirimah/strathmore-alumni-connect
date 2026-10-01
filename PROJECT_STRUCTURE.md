# Alumni Mentorship Platform Structure

> **Status: implemented.** This file was written as a proposal before the backend
> and ML work existed. The structure below was followed, with two deliberate
> departures recorded under [What changed](#what-changed). For the layout as it
> actually stands, plus setup and demo instructions, see [README.md](README.md).

This project is organized into separate layers so the existing prototype UI can remain in place while the product is evolved into a full frontend + backend + ML matching system.

## Keep during initial implementation
- src/App.tsx
- src/main.tsx
- src/index.css

These files currently contain the working design prototype and should remain intact while we build the production structure around them. They can be refactored or removed later once the new architecture is implemented.

## Proposed structure

```text
.
├── frontend/
│   └── src/
│       ├── app/
│       │   ├── routes/
│       │   ├── layouts/
│       │   └── providers/
│       ├── components/
│       │   ├── common/
│       │   ├── cards/
│       │   ├── forms/
│       │   ├── tables/
│       │   └── modals/
│       ├── features/
│       │   ├── auth/
│       │   ├── students/
│       │   ├── mentors/
│       │   ├── dashboards/
│       │   ├── events/
│       │   ├── messaging/
│       │   ├── communities/
│       │   └── admin/
│       ├── hooks/
│       ├── lib/
│       │   ├── api/
│       │   ├── utils/
│       │   ├── constants/
│       │   └── validators/
│       ├── styles/
│       ├── types/
│       └── index.css
│
├── backend/
│   └── src/
│       ├── config/
│       ├── modules/
│       │   ├── auth/
│       │   ├── students/
│       │   ├── mentors/
│       │   ├── mentorship/
│       │   ├── messaging/
│       │   ├── events/
│       │   ├── communities/
│       │   └── admin/
│       ├── services/
│       ├── controllers/
│       ├── dto/
│       ├── entities/
│       └── app/
│
├── ml-matching/
│   ├── app/
│   ├── models/
│   ├── schemas/
│   ├── utils/
│   └── requirements.txt
│
├── shared/
│   └── types/
│
├── src/
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
│
├── package.json
├── vite.config.ts
├── tsconfig.json
├── index.html
├── pnpm-lock.yaml
└── README.md
```

## Notes
- The current root-level `src` implementation acts as the visual prototype and should remain as the initial working product.
- The new `frontend/` and `backend/` folders are where production-ready components and APIs will be created.
- The `ml-matching/` folder will hold the recommendation or ranking engine for student-to-mentor matching.
- After the new structure is complete, the legacy root-level `src/App.tsx`, `src/main.tsx`, and `src/index.css` can be removed in a cleanup phase.

## What changed

Two parts of the proposal above were not built as drawn, both for concrete reasons:

### `shared/types/` was dropped

The plan was a shared TypeScript package generated from the backend's schemas and
imported by both sides. In practice the contract already has a single source of
truth — the Zod schemas that validate every route boundary in
`backend/src/modules/*/\*.schemas.ts` — and the client's view of it lives in
`frontend/src/types/index.ts`. Adding a generated package between them would have
meant a codegen step in both builds and a third place for the contract to be
stale, in exchange for very little on a single-repository local build. The empty
`shared/` directory has been removed rather than left as a stub implying work is
pending.

### The backend uses a module-per-domain layout, not layered folders

The proposal listed `services/`, `controllers/`, `dto/` and `entities/` as
sibling top-level folders. The backend instead groups by domain, with each module
owning its own routes, service, repository and schemas:

```text
backend/src/modules/mentorship/
├── mentorship.routes.ts      # HTTP: validation, status codes
├── mentorship.service.ts     # business rules: capacity, ownership, transactions
├── mentorship.repository.ts  # prepared statements
└── mentorship.schemas.ts     # Zod schemas (the contract)
```

Everything one feature touches sits together, so a change to how requests are
accepted is one folder rather than four. Genuinely cross-cutting concerns still
live outside the modules: `config/`, `db/`, `lib/`, `plugins/` (auth guards, the
matching worker) and `services/matching/` (the Python bridge).

### The legacy root-level `src/`

The proposal anticipated deleting it in a cleanup phase. It has been kept as the
original design export, reachable with `npm run dev:design` for visual comparison
against the built app. It is not part of the running application and nothing
imports from it.
