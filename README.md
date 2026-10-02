# Endirimim

Endirimim is a TypeScript price comparison and discount discovery platform: a React (Vite) web
client backed by a Fastify + PostgreSQL API.

## Run locally

```bash
npm install
cp .env.example .env          # then set DATABASE_URL and AUTH_SECRET
npm run db:setup              # create the database itself
npm run db:migrate            # create the tables
npm run api:dev               # API on http://localhost:3000
npm run dev                   # web client on http://localhost:5173
```

`DATABASE_URL` needs a real password before any of this works. On Windows the PostgreSQL
superuser is `postgres`, and the password is the one chosen at install time:

```
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/endirimim
```

There is no need for `psql` on your `PATH` — `db:setup` connects with the same credentials as
the app and creates the database if it is missing. If the credentials are wrong, both scripts
say so explicitly rather than printing a driver stack trace.

| Script | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server for the web client |
| `npm run api` / `api:dev` | Run the API (once / with watch mode) |
| `npm run build` | Typecheck and build the web client |
| `npm run typecheck` | Typecheck the client and the server |
| `npm run db:setup` | Create the database named in `DATABASE_URL` if it does not exist |
| `npm run db:generate` | Generate a migration from `server/src/db/schema.ts` |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:push` | Push the schema directly (development only) |
| `npm run db:studio` | Browse the database |
| `npm run smoke` | In-process API wiring checks (no database needed) |
| `npm run test:auth` | Registration, password recovery and merchant permission checks in a throwaway database |
| `npm run user:role -- <email> admin` | Promote an existing account (how the first production admin is made) |

## Workspace routes

- `/dashboard` - personal user shopping dashboard
- `/favorites` - saved product collection
- `/lists` - shopping lists
- `/alerts` - price tracking
- `/store` - merchant analytics overview
- `/store/products` - merchant product management and image upload entry
- `/store/analytics` - merchant performance view
- `/store/media` - merchant media library entry

## Architecture

```
server/src
  app.ts                 Fastify factory: plugins + route modules
  index.ts               entrypoint, startup DB check, graceful shutdown
  config/env.ts          Zod-validated environment contract (fails fast)
  db/schema.ts           Drizzle schema (mirrors database/schema.sql)
  db/client.ts           pg pool, Drizzle client, rawRows() escape hatch
  lib/                   errors, password hashing, tokens, slugs, cookies, pagination,
                         db-errors (turns driver codes into actionable messages)
  scripts/               one-off operator tasks (smoke test, database setup)
  plugins/               error envelope, auth/authorization decorators
  storage/               storage driver interface (+ local disk driver)
  mail/                  mailer interface (+ console driver)
  modules/<feature>/     routes colocated with their domain service
```

The API is versioned under `/api/v1`. Errors always use one envelope:

```json
{ "error": { "code": "conflict", "message": "...", "details": [] } }
```

### Authentication

- **Access token**: HS256 JWT (15 min) sent as `Authorization: Bearer <token>`. It carries a
  `sid` claim pointing at its session row, so it can be revoked before it expires.
- **Refresh token**: opaque 48-byte random value (30 days), stored only as a SHA-256 hash.
  Returned in the JSON body **and** set as an httpOnly cookie scoped to `/api/v1/auth`.
- **Rotation with reuse detection**: each refresh token is single-use. Presenting an already
  consumed token revokes *every* session for that user, which is the standard response to a
  stolen-token replay. The one exception is `REFRESH_REUSE_GRACE_SECONDS` (default 10): a token
  rotated moments ago whose successor is still live gets a fresh session instead, so two tabs
  refreshing at once do not log the user out.
- **Sign-in** uses email and password. Registration opens a session immediately; no email verification is required.
- **Cookies** use `COOKIE_SAME_SITE` (`lax` by default). Set `none` when the web app and API are
  on different sites.
- Passwords use `scrypt` from `node:crypto` (N=2^15, r=8, p=1) — no native addon to compile.

### Authorization model

| Actor | Can do |
| --- | --- |
| Anonymous | Browse catalog, search, offers, reviews, price history, public merchant profiles, active campaigns, comparison matrix |
| `user` | Own favorites, lists, alerts, comparisons, notifications, reviews, profile |
| `store` | Everything a user can, plus own merchant profile, offers, campaigns, media, analytics, and creating products with an initial offer |
| `admin` | Edit/delete shared catalog entries, taxonomy, brands, SEO metadata, and other merchants' content |

Two rules are enforced in one place each, never at call sites:

1. **Merchant ownership** — merchant writes always filter by the caller's `merchantId` resolved
   from `merchants.owner_user_id`. A client-supplied `merchantId` is never trusted.
2. **Derived discounts** — `discount_percentage` is always computed server-side from
   `old_price`, so a merchant cannot advertise a fake discount.

Owned resources that are not found belonging to the caller return `404`, not `403`, so ids are
not enumerable across accounts.

### Data layer

`database/schema.sql` remains the bootstrap for a fresh database; `server/src/db/schema.ts`
mirrors it and Drizzle owns migrations from here on (`server/drizzle/`). Change both together.

Sessions and password recovery use `refresh_tokens` and `password_reset_tokens`.
The legacy `email_verification_tokens` table is retained for database compatibility and is no longer used.

Two write paths maintain derived state:

- Every offer create/update appends to `price_history` and then evaluates pending `price_alerts`,
  creating notifications. `triggered_at` is the idempotency key, so an alert fires once.
- Review create/update/delete recomputes `products.rating` and `review_count`.

### Known gaps

These are deliberate, and each fails loudly rather than silently:

- **Email needs Resend in production.** Without `RESEND_API_KEY` and `MAIL_FROM`, messages are
  printed in development and logged as `DROPPED` in production. A transport is needed for password recovery.
- **Rate limits and analytics de-duplication live in process memory.** On Vercel every function
  instance keeps its own counters, so limits are per instance. A shared store
  (`@fastify/rate-limit` supports Redis) is needed for strict global limits.
- **pglite is single-process.** The API takes a lock (`.data/pglite.lock`); `db:migrate` and
  `db:seed` refuse to run while it is up — stop the API first. `npm run smoke` uses an in-memory
  database and is always safe. `drizzle-kit` commands (`db:push`, `db:studio`) bypass the lock.

## Deploying to Vercel

One Vercel project serves both halves from the same origin, which the refresh cookie and the
client's relative `/api/v1` base rely on:

- the Vite build (`dist/`) is served as static files, with an SPA fallback to `index.html`;
- `api/index.ts` wraps the Fastify app as a single function; `vercel.json` rewrites `/api/*` and
  `/health*` to it with the original URL intact.

The API refuses to start on Vercel with pglite or local storage. Required project settings:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Neon **pooled** connection string (added by the Neon integration) |
| `DATABASE_POOL_MAX` | `3` — each function instance holds its own small pool |
| `AUTH_SECRET` | a fresh random value, never the development one |
| `NODE_ENV` | `production` |
| `APP_URL`, `CORS_ORIGINS` | the public site URL, e.g. `https://endirimim.vercel.app` |
| `STORAGE_DRIVER` | `vercel-blob` (`BLOB_READ_WRITE_TOKEN` comes from the connected Blob store) |
| `MAX_UPLOAD_BYTES` | `4194304` |
| `RESEND_API_KEY`, `MAIL_FROM` | Resend credentials, for password reset emails |

Apply migrations from your machine against the production database (`db:seed` refuses to run
against it — demo accounts share a published password):

```bash
vercel env pull .env.production.local
npx tsx --env-file=.env.production.local server/src/db/migrate.ts
```
