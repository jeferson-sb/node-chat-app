# Authentication: Better Auth over Firebase / Auth.js

- Status: Accepted (decision only — not yet implemented, see Consequences)
- Date: 2026-08-09

## Context

ChatMe has no authentication today. "Identity" is a free-text nickname typed
into `apps/client/src/components/Join.vue`, pushed straight into the URL
(`/chat/:username/:room`, see `apps/client/src/router.ts`), and read back out
by `Chat.vue` — there's no account, password, or persisted user record
anywhere. `SocketController.onJoinRoom` (see
`apps/server/src/presentation/controllers/SocketController.ts`) only checks
that the nickname isn't already active *in the current room roster*
(`RoomRepository`, see `docs/adr/2026-08-09-horizontal-scaling.md`) — nothing
stops two different people from both typing "alice" in different rooms, or
the same person from reconnecting as a different name.

This matters now because:

- Task 2 (`docs/TASK_TRACKER.md`) wants persisted chat history "when they log
  back in" — which presupposes a stable identity to persist history *against*.
  Without accounts, "logging back in" as the same user isn't a coherent
  concept.
- The app already runs multiple server replicas behind a load balancer
  (`docker-compose.yml`, `nginx.conf`), so whatever auth mechanism is chosen
  has to work statelessly or with shared state across nodes — the same
  constraint that shaped the Redis-backed `RoomRepository` decision.
- Two options were raised: Firebase Auth and Auth.js (next-auth).

## Decision

Use **Better Auth** instead of either option raised.

**Why not Auth.js (next-auth):** Auth.js's server-side integration story is
built around a framework request/response lifecycle (first-class support is
Next.js; the generic/Express-style adapters are comparatively less mature).
ChatMe's server is a plain Express app whose only real job is the Socket.IO
handshake — there's no page-render cycle for Auth.js's session-cookie model
to hook into on the way in. Retrofitting it here means fighting the
library's core assumptions rather than using them.

**Why not Firebase Auth:** Firebase would technically work — it issues a
portable ID token the client could pass via
`io(url, { auth: { token } })`, and every server replica verifies it
statelessly with `firebase-admin`, no shared session store needed. But it's
the first hard dependency on a third-party managed vendor in a project that
has otherwise deliberately stayed self-hosted and vendor-neutral at every
other step of this modernization (own Docker Compose stack, own Redis, own
Nginx, Fly.io for deploy rather than a PaaS-with-built-in-auth). Firebase
Auth would be a scope/vendor mismatch with that established direction, not
a technical failure.

**Why Better Auth:** TypeScript-native, framework-agnostic (works directly
with Express, no Next.js assumption), self-hosted (own database, own
`auth.ts` config — no new vendor account required), and supports the same
stateless-token pattern Firebase offered via its `bearer`/`jwt` plugins, so
the Socket.IO handshake verification story is equivalent without the vendor
lock-in. It needs a database, which is a new piece of infrastructure this
repo doesn't have yet — see below.

## Scope: accounts become mandatory

Joining a room will require a signed-in account; the current
type-a-nickname-and-go flow in `Join.vue` goes away. This is a deliberate,
larger UX change (signup/login screens, protecting the `/chat` route) chosen
over layering optional accounts on top of the existing anonymous flow,
because:

- A mixed guest/account model means every downstream feature (Task 2's chat
  history, room membership, "username already in use") has to handle both an
  authenticated `User` and an anonymous nickname as valid identities, roughly
  doubling the branching in `SocketController` and the client for
  comparatively little value at this app's current scale.
- Task 2 (persisted chat history) only makes sense against a stable,
  authenticated identity in the first place, per the Context section above.

## Database: PostgreSQL, not SQLite

Better Auth needs a database (`database` option in its config, per the
better-auth-best-practices skill's setup workflow). SQLite was considered
since it needs no separate service, but was rejected: SQLite's Fly.io story
for surviving across multiple machines requires LiteFS (a FUSE-mounted
replicated filesystem with primary election), which directly conflicts with
the multi-replica, round-robin load-balanced architecture from
`docs/adr/2026-08-09-horizontal-scaling.md` — a plain SQLite file on a Fly
Volume is pinned to one machine, the opposite of what that ADR set up.
Postgres (an external managed instance — Fly deprecated its own managed
Postgres offering — reached via `DATABASE_URL`, same pattern as `REDIS_URL`
today) has no such constraint and is also the natural fit for Task 2's chat
history once that lands, likely sharing the same database.

## Consequences

- **Not implemented yet.** This ADR records the decision (Better Auth +
  Postgres + mandatory accounts) so Task 2 and this task can be sequenced
  and implemented together later, rather than landing a partial auth layer
  now. No code changes accompany this ADR.
- When implemented, expect at minimum: a Postgres service (added to
  `docker-compose.yml`, alongside the existing `redis` service), an
  `auth.ts` + Better Auth's Express route handler wired into
  `apps/server/src/presentation/createApp.ts`, a signup/login UI replacing
  `Join.vue`, a route guard on `/chat/:room` (the `:username` route param
  goes away — identity comes from the session instead), and Socket.IO
  handshake verification (likely Better Auth's `bearer`/`jwt` plugin, so
  every load-balanced replica can verify a token statelessly, consistent
  with how the Redis adapter/`RoomRepository` already handle cross-replica
  state).
- `SocketController.onJoinRoom`'s "username already in use" check
  (`apps/server/src/presentation/controllers/SocketController.ts`) becomes
  redundant for authenticated users (usernames are unique account
  identifiers, enforced by Better Auth/the DB) but still matters for
  same-room-different-tab scenarios — needs revisiting during
  implementation.
- Introduces Postgres as new infrastructure with its own operational
  surface (migrations, connection pooling across N server replicas,
  backups) — reasonable to take on given Task 2 needs it too, but worth
  naming explicitly since this repo has otherwise had zero persistent
  storage until now.

## Alternatives considered

- **Firebase Auth**: technically sound (stateless JWT verification fits the
  multi-replica setup as well as Better Auth would), rejected for
  introducing vendor lock-in inconsistent with the rest of this
  modernization's self-hosted direction.
- **Auth.js (next-auth)**: rejected — its integration model assumes a
  framework request/response lifecycle this Express + Vite SPA app doesn't
  have; the Express-side story is comparatively immature next to its
  Next.js-first design.
- **SQLite + LiteFS**: would avoid running a separate Postgres service, but
  trades that for FUSE-mount and primary-election operational complexity
  that undermines the point of choosing SQLite for simplicity in the first
  place. Rejected in favor of Postgres.
- **Optional accounts alongside the existing anonymous nickname flow**:
  smaller UX change, but doubles the identity-branching surface across
  `SocketController`, `RoomRepository`, and (eventually) Task 2's chat
  history for little payoff at this app's scale. Rejected in favor of
  making accounts mandatory.
