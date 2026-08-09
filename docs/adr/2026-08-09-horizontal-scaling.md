# Horizontal scaling: load balancer + shared room state

- Status: Accepted
- Date: 2026-08-09

## Context

`docs/TASK_TRACKER.md` Task 4 asks for Nginx or HAProxy in front of multiple
chat server instances. `SocketController` (see
`apps/server/src/presentation/controllers/SocketController.ts`) kept its
room roster in a plain in-process `Map`/`Set`, and `setupSocketServer`
(`apps/server/src/presentation/websocket.ts`) used socket.io's default
in-memory adapter for `io.to(room).emit(...)`.

Putting a load balancer in front of multiple instances of that server as-is
would be broken, not just "less scalable": two users joining the same room
but landing on different server processes would never see each other's
messages (each process only broadcasts to — and tracks — the clients
connected to itself), and the "username already in use" check and sidebar
user list would only reflect whichever server the checking client happened
to be talking to. Task 4 (load balancing) and Task 1 (session/shared state)
are therefore coupled: load-balancing chat servers requires solving the
shared-state problem first, or the load balancer just makes the bug more
visible by spreading users across processes more aggressively.

## Decision

1. **Redis pub/sub adapter for broadcast** — `createApp.ts` wires
   `@socket.io/redis-adapter` (with `ioredis` clients) into
   `setupSocketServer` whenever `REDIS_URL` is set, so
   `io.to(room).emit(...)` fans out to every node subscribed to that
   room, not just the sender's own process.
2. **Redis-backed room roster** — introduced a `RoomRepository`
   abstraction (`apps/server/src/infra/rooms/RoomRepository.ts`) with two
   implementations: `InMemoryRoomRepository` (the original Map-based
   behavior, used when `REDIS_URL` is unset) and `RedisRoomRepository`
   (a single Redis hash of `socketId -> ChatUser` JSON, read/written via
   `hset`/`hget`/`hdel`/`hgetall`). `SocketController`'s methods became
   `async` to support this. Without this, the pub/sub adapter alone would
   still leave the sidebar user list and username-uniqueness check
   inconsistent across nodes — Task 4 isn't really done without it, even
   though it's also most of Task 1 ("session management... across chat
   servers").
3. **Websocket-only client transport** — `apps/client/src/components/Chat.vue`
   now connects with `io(url, { transports: ['websocket'] })` instead of
   the default (long-polling handshake, then upgrade). A websocket
   connection is one persistent TCP connection, so plain round-robin load
   balancing is safe; the alternative (sticky sessions/session affinity)
   is only needed because HTTP long-polling makes multiple independent
   HTTP requests per client that must all land on the same node. This
   keeps `nginx.conf` simpler (no cookie or IP-hash upstream directives)
   at the cost of slightly worse compatibility with very restrictive
   client networks that block websockets outright — acceptable for this
   app.
4. **docker-compose.yml as the reference architecture** — three
   `@chatme/server` replicas (`server1`/`server2`/`server3`, same image,
   built once from the existing root `Dockerfile`) behind an `nginx`
   service doing round-robin `proxy_pass`, plus a `redis` service. This is
   a local dev/demo artifact, not a production deploy target — see
   Alternatives below for why Fly.io wasn't changed.

## Consequences

- `SocketController.onJoinRoom`/`onSendMessage`/`onDisconnect` are now
  `async`; `createApp.ts`'s socket event handlers `.catch(console.error)`
  each call instead of awaiting, so a transient Redis error surfaces as a
  log line instead of an unhandled promise rejection that could crash the
  process.
- `server.ts` now handles `SIGINT`/`SIGTERM` to close the Redis
  connections `createApp()` opened (`App.close()`), for a clean shutdown
  when running as one of several replicas that get stopped/restarted
  independently.
- Without `REDIS_URL` set, behavior is unchanged from before this ADR —
  single process, in-memory roster, default socket.io adapter. This is
  intentional: local dev (`pnpm dev`) and the existing Playwright e2e
  suite (`e2e/chat.spec.ts`) don't need Redis running.
- `RedisRoomRepository` does an `hgetall` (all users, across every room)
  for every `findUserByUsername`/`getUsersInRoom` call, mirroring
  `InMemoryRoomRepository`'s O(n) scan over its Map. Fine at this app's
  scale (a handful of concurrent users per room); would need a per-room
  Redis key (e.g. a set of socketIds per `room:<name>`) if room sizes grew
  much larger.
- No automated test covers the Redis-backed path end-to-end (multiple
  real server processes + real Redis). `RedisRoomRepository`'s logic was
  spot-checked against `ioredis-mock` during development (not committed —
  wouldn't catch real Redis pub/sub or network behavior anyway) and
  should be verified with `docker compose up --build` before relying on
  this in production; see docs/TASK_TRACKER.md Task 4.

## Alternatives considered

- **Sticky sessions (IP-hash or cookie-based) instead of websocket-only
  transport**: keeps long-polling as a fallback for restrictive networks,
  but adds upstream-hashing config to `nginx.conf` and — per the
  socket.io docs — still doesn't survive a node being removed/restarted
  (clients hashed to that node have to reconnect and get re-hashed
  anyway). Rejected in favor of disabling long-polling, since this app
  has no requirement to support networks that block websockets.
- **Per-room Redis keys for the roster** (e.g. a Redis Set per room)
  instead of one hash of all users: would avoid the O(n) `hgetall` scan,
  but adds a second write path to keep in sync (add to both the room set
  and a socketId index for `removeUser`/disconnect) for no measurable
  benefit at this app's scale. Rejected; revisit if room sizes grow.
- **Updating Fly.io (`fly.toml`) for multi-machine scaling**: Fly already
  load-balances across machines at its edge proxy natively (no
  self-hosted Nginx/HAProxy needed there), and Fly's proxy uses
  `fly-replay`/consistent routing for websockets rather than the
  sticky-session mechanisms this ADR's `nginx.conf` documents. Bringing
  Nginx into the Fly deploy would be redundant. `docker-compose.yml` is a
  local reference architecture for the Nginx/HAProxy-style load balancing
  Task 4 explicitly asked for; the Redis adapter and `RoomRepository`
  changes benefit Fly's native scaling too, but `fly.toml` itself wasn't
  changed here.
- **HAProxy instead of Nginx**: HAProxy is arguably a more "native" fit
  for L4/websocket load balancing and is one of the two options Task 4
  named. Nginx was chosen for familiarity and because its config for this
  simple round-robin case is shorter; either could replace `nginx.conf`
  without touching the server-side Redis changes.
