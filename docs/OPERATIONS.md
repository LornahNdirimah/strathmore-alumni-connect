# Operations

How to run Strathmore Alumni Connect for real users, keep its data safe, and
what moving off SQLite would take (DESIGN_BACKLOG #53, #57).

## Running it

The site is one process on one origin: the API serves the built frontend.

```bash
npm --prefix backend ci && npm --prefix frontend ci
pip install -r ml-matching/MachineLearning/requirements.txt
cp backend/.env.example backend/.env    # set JWT_SECRET, APP_URL, CORS_ORIGIN, SMTP_*
npm run serve                            # builds the frontend if needed, then serves
```

`npm run serve` runs the backend with `NODE_ENV=production` and
`SERVE_FRONTEND=true`. In production:

- **Cookies are `Secure`**, so the site must be served over HTTPS. Put a
  reverse proxy (Caddy, nginx) in front for TLS and point it at `HOST:PORT`.
- **`APP_URL` and `CORS_ORIGIN`** must be the public address, e.g.
  `https://alumni.strathmore.edu`. Links in emails are built from `APP_URL`.
- **Rate limits** are per client address. Behind a proxy every request comes
  from the proxy's address; either enable Fastify's `trustProxy` for that
  proxy, or raise `RATE_LIMIT_PER_MINUTE` (sign-in stays at 10 a minute).
- **Content Security Policy.** Serving the page, the API allows only its own
  scripts, styles and API, plus the landing page's Unsplash photo. A new
  third-party asset needs adding in `backend/src/app.ts`.
- **The matching worker** is a Python child process the API starts and
  supervises. If Python or its packages are missing, recommendations fall back
  to a simpler ranking and `/api/health` reports `"matching": "down"`.
- **Email** needs a real SMTP relay (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
  `SMTP_PASS`, `MAIL_FROM`); see the README's *Email* section.

Health: `GET /api/health` returns the database and matching status, suitable
for an uptime check or a load balancer.

## Logs and request ids

Logs are JSON lines (pino) on stdout. Every line a request writes carries its
`reqId`, and every response carries the same value in `X-Request-Id`. A
well-formed `X-Request-Id` from the proxy is reused, so one id can be followed
from the proxy's access log into the API's. A 500 response includes the id in
its body (`error.requestId`) — ask whoever reports a failure for it, then:

```bash
journalctl -u alumni-connect | grep '"reqId":"<id>"'
```

## Backups

```bash
npm run db:backup
```

takes a consistent snapshot with SQLite's online backup API — safe while the
site is running — checks it with `PRAGMA integrity_check`, and keeps the newest
`BACKUP_KEEP` (default 14) in `BACKUP_DIR` (default `backend/data/backups/`).
Each backup is one self-contained `.db` file.

Schedule it, and copy the folder off the machine — a backup on the same disk
does not survive the disk:

```cron
30 2 * * *  cd /srv/alumni-connect && npm run db:backup >> /var/log/alumni-backup.log 2>&1
45 2 * * *  rclone sync /srv/alumni-connect/backend/data/backups remote:alumni-backups
```

Profile photos live beside the database in `backend/data/uploads/`; back that
folder up the same way.

**Restoring:** stop the service, move the current `app.db` (and any `app.db-wal`
/ `app.db-shm`) aside, copy the chosen backup to `DATABASE_PATH`, and start the
service. Pending migrations apply on start.

**Retention and deletion.** A deleted account is anonymised in the live
database at once, but remains in backups until they rotate out — at most
`BACKUP_KEEP` days with nightly backups. Say so in the privacy notice once the
real retention is decided.

## Moving to Postgres

SQLite in WAL mode serves one API process comfortably: reads are concurrent,
writes are serialised and short. Move when any of these becomes true:

- more than one API process is needed (more traffic, or zero-downtime deploys);
- the host cannot give the database a local disk;
- reporting needs to run against a live replica.

What the move involves, in order:

1. **Make data access asynchronous.** `node:sqlite` is synchronous; every
   Postgres client is not. `db/repository.ts` (`queryAll`, `queryOne`,
   `execute`, `transaction`) is the only place SQL is executed, so its
   functions become `async` and each caller gains an `await`. This is the
   largest change and is mechanical; do it first, still on SQLite, behind the
   existing tests.
2. **Translate the schema.** The migrations use portable types (`TEXT`
   timestamps in ISO 8601, `INTEGER` booleans, `CHECK` constraints) and
   translate directly. Write a fresh Postgres baseline equal to the current
   schema rather than replaying the SQLite history; the table-rebuild
   migrations (`-- migrate: foreign_keys=off`) exist only because SQLite
   cannot alter constraints.
3. **Replace the SQLite-only SQL.** A handful of queries use SQLite dialect:
   `COLLATE NOCASE` (use `ILIKE` or `citext`), `GLOB` (use `~`), scalar
   `MAX(a, b)` (use `GREATEST`), and `INSERT OR IGNORE` / `ON CONFLICT` forms.
   `grep -rn "COLLATE NOCASE\|GLOB\|INSERT OR\|MAX(0" backend/src` finds them.
4. **Placeholders.** `?` becomes `$1, $2, …`; do it inside `repository.ts` so
   call sites do not change.
5. **Move the data** with a one-off script that reads each table from the
   SQLite file and bulk-inserts it, in foreign-key order (the order
   `TABLES_IN_DELETE_ORDER` in the tests reverses).
6. **Live updates across processes.** The notification hub is in memory;
   with several processes, publish its hints through `LISTEN/NOTIFY` so every
   process can pass them to its own connected browsers.
7. **Backups** become `pg_dump` (or the provider's snapshots) instead of
   `npm run db:backup`.

The tests keep running against SQLite until step 3, then against a Postgres
service container in CI.
