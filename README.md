# ChatApp

Lightweight chat app built with Express, Socket.io and Vue.js — with real
accounts, persisted history, and horizontal scaling.

![Alt text](.github/mockup.png)

## 🛠 Tools

**Runtime**

- [Node.js](https://nodejs.org/en/docs/)
- [Vue](https://vuejs.org/)
- [Express](http://expressjs.com/)
- [Socket.io](https://socket.io/)

**Data & auth**

- [Better Auth](https://www.better-auth.com/) — accounts and sessions
- [PostgreSQL](https://www.postgresql.org/) — backs Better Auth
- [Redis](https://redis.io/) — room roster, cross-node broadcast, and the
  chat-history write queue
- [ScyllaDB](https://www.scylladb.com/) — persisted chat history

**Infra & testing**

- [Nginx](https://nginx.org/) — load balancing
- [Docker Compose](https://docs.docker.com/compose/) — local multi-service stack
- [Vitest](https://vitest.dev/) / [Playwright](https://playwright.dev/) — unit & e2e tests
- [Turborepo](https://turbo.build/) — monorepo tasks

## 💻 Demo

[Click here](https://chatme-app.netlify.app/)

> [!NOTE]
> Accounts are required — the old anonymous nickname flow is gone. Sign up
> or log in before joining a room.

## 🏗️ Architecture

![ChatMe architecture diagram](docs/architecture.svg)

A client connects through an Nginx load balancer to one of several
stateless `@chatme/server` replicas. Every replica shares the same three
backing stores rather than owning its own:

- **Redis** — the room roster, the socket.io cross-node broadcast adapter,
  and a Streams-based queue that buffers chat-history writes.
- **PostgreSQL** — user accounts, via Better Auth. A socket connection is
  only accepted once its session is verified against this database — the
  check gates the handshake, it doesn't happen alongside it.
- **ScyllaDB** — persisted chat history (one 3-node cluster, not one per
  replica), written asynchronously off the Redis queue with retry and
  dead-lettering, so a slow or unreachable Scylla can't stall or lose a
  live message.

Real-time delivery never waits on persistence: a sent message is
broadcast to its room immediately, and only then buffered for the
history write.

The full reasoning — and the alternatives that were considered and
rejected — lives in the ADRs:

- [Modernize the stack](docs/adr/2026-08-09-modernize-stack.md)
- [Horizontal scaling](docs/adr/2026-08-09-horizontal-scaling.md)
- [Authentication](docs/adr/2026-08-09-authentication.md)
- [Chat history storage](docs/adr/2026-08-11-chat-history-storage.md)
- [Message queue persistence](docs/adr/2026-08-11-message-queue-persistence.md)

See [`docs/TASK_TRACKER.md`](docs/TASK_TRACKER.md) for what's implemented
versus still open.

## ⚖️ Trade-offs

- **Redis/Scylla are optional, not required** — without `REDIS_URL`/
  `SCYLLA_CONTACT_POINTS` the app falls back to single-process in-memory
  storage, so it runs standalone but loses horizontal scaling and durable
  history.
- **Postgres for accounts has no fallback** — a missing `DATABASE_URL`
  fails loudly at startup rather than silently disabling auth.
- **Messages broadcast before they're persisted** — real-time delivery
  never waits on storage, at the cost of a message briefly being live
  before it's guaranteed durable.
- **Bounded, dead-lettering write queue** — a bad message dead-letters
  instead of stalling every other write, but a long outage can trim older
  pending entries.
- **Room membership and read-cursors are never deleted** — enables
  accurate presence and missed-message delivery, but both stores grow
  unboundedly over time.
- **One active room per user, not true multi-room presence** — keeps
  switching rooms simple, but rules out being in two rooms at once
  without a bigger rework.
- **Websocket-only, no long-polling fallback** — simpler load balancing
  with no sticky sessions, but no support for networks that block
  websockets.
- **Manual composition root, no DI container** — easy to read at today's
  size, but won't auto-scale if service wiring gets much more
  conditional.
- **Redis/Scylla-backed repositories are verified manually, not by
  automated tests** — keeps the test suite fast, but real-backend
  regressions can slip past CI.

## 🚀 Quick Start

> [!NOTE]
> There are two `.env` files, and they're read by different things: the
> root `.env` is only interpolated into `docker-compose.yml`, while a local
> `pnpm dev` server reads `apps/server/.env` (its own working directory).
> Each has a matching `.env.example` to copy — start with the one for the
> path you're taking below.

### Installation

```bash
git clone https://github.com/jeferson-sb/node-chat-app.git && cd node-chat-app
```

```bash
pnpm install
```

### Usage

```bash
cp apps/server/.env.example apps/server/.env
pnpm dev
```

### Running the full stack locally

The architecture above — load-balanced servers sharing Redis, Postgres,
and a 3-node ScyllaDB cluster — is fully reproducible locally. Docker
Compose only covers the backend (`server1/2/3`, Redis, Postgres, Scylla,
Nginx) — the client is a separate step, run against Nginx rather than
any single replica:

```bash
cp .env.example .env
echo "BETTER_AUTH_SECRET=$(openssl rand -base64 32)" >> .env
docker compose up --build

# one-time, once the stack is healthy (idempotent to re-run):
DATABASE_URL=postgres://postgres:postgres@localhost:5432/chatme pnpm --filter @chatme/server run db:migrate:auth
DATABASE_URL=postgres://postgres:postgres@localhost:5432/chatme pnpm --filter @chatme/server run db:migrate:user-rooms
SCYLLA_CONTACT_POINTS=localhost pnpm --filter @chatme/server run db:migrate:scylla

# in another terminal:
VITE_SOCKET_URL=http://localhost:8080 pnpm --filter @chatme/client run dev
```

Then open `http://localhost:5173`

## 📝License

This project is licensed under the [MIT License](https://github.com/jeferson-sb/node-chat-app/blob/master/LICENSE.md)

`Made with ❤ by Jeferson © 2020`
