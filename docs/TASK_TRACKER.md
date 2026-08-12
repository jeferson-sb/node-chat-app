Create a new branch for each task you take. The branch name should be using dashes and be descriptive of the task, for example: `fix/panel-screen-navigation` or `feat/dockerize-api`.

Interview me relentlessly about every aspect of the task in hand until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.

If a question can be answered by exploring the codebase, explore the codebase instead.

Once you finish a task, review the code and ask yourself this questions:
- Can I make it faster?
- Does the UX make sense? (Remember this app is for REAL users)
- Can I make it cleaner?
- Did I break any existing functionality?

At the end of each task, mark as completed on this issue tracker.

## Task 1 - Session management

Use Redis for session management across chat servers.

Priority: Medium
Completed: [~] Partial — Task 4 introduced a Redis-backed room roster
(RedisRoomRepository, see apps/server/src/infra/rooms/) so the sidebar
user list and username-uniqueness check work correctly across multiple
server nodes. Actual user *sessions* (auth, reconnect-with-history) are
still out of scope; there's no auth in this app yet.

## Task 2 - Chat persistance

Priority: Medium
Completed: [~] Partial — ScyllaDB-backed history wired end-to-end per
docs/adr/2026-08-11-chat-history-storage.md: `SocketController.onSendMessage`
persists real user messages (`apps/server/src/infra/history/`), `onJoinRoom`
emits the last 50 as a new `history` socket event, and `Chat.vue` renders
them before any live messages arrive. Falls back to
`InMemoryMessageHistoryRepository` when `SCYLLA_CONTACT_POINTS` is unset
(same graceful-degrade pattern as Redis/`RoomRepository`), covered by
`SocketController.test.ts` against that fallback.

Not yet verified against a real cluster: this dev machine's Docker
Desktop VM only has ~1.9GB RAM, not enough to run the 3-node cluster in
`docker-compose.yml` (a single developer-mode Scylla node alone
crash-looped on `insufficient physical memory`). `ScyllaMessageHistoryRepository`
and the migration script (`pnpm run db:migrate:scylla`) are therefore
unverified against a real Scylla/Cassandra wire protocol — same
"manual verification, not automated" category as `RedisRoomRepository`
(docs/adr/2026-08-09-horizontal-scaling.md), except the manual step itself
is still outstanding here. Revisit once more memory is available, or on
a machine/CI runner that can fit the cluster.

Acceptance criteria:
- [x] Users can see their previous chat history when they log back in
      (verified via `SocketController.test.ts` against the in-memory
      fallback; not yet against a real Scylla cluster, see above).

## Task 3 - Scalability with Message Queue

Use Redis/RabbitMQ for message queueing to handle high traffic and ensure messages are delivered in order and for routing between nodes

Priority: Medium
Completed: [x] Cross-node routing was already solved by Task 1/4's
`@socket.io/redis-adapter` pub/sub - real-time broadcast is untouched by
this task. What was missing: `SocketController.onSendMessage`'s Scylla
write was synchronous with the broadcast, so a slow/failed write stalled
delivery and silently lost the message. Decision and full reasoning in
docs/adr/2026-08-11-message-queue-persistence.md.

Added a Redis Streams queue (`apps/server/src/infra/queue/`) buffering
only the persistence write: `onSendMessage` now broadcasts first, then
`messageQueue.enqueue(...)`s the message onto a single global stream
(`chatme:messages:pending`). An in-process consumer
(`RedisMessagePersistenceRunner` + `MessagePersistenceConsumer`), started
per `@chatme/server` replica and sharing one consumer group, reads
entries and persists them via the existing `MessageHistoryRepository`,
retrying with backoff and dead-lettering to `chatme:messages:dead` after
repeated failures. Falls back to `InMemoryMessageQueue` (direct,
synchronous passthrough) when `REDIS_URL` is unset - same graceful-degrade
pattern as `RoomRepository`/`MessageHistoryRepository`.

The retry/dead-letter decision logic is unit-tested in isolation
(`MessagePersistenceConsumer.test.ts`, fakes for the history repo and
stream ack/dead-letter calls, no real Redis needed).
`SocketController.test.ts` covers the broadcast-not-blocked-by-enqueue-
failure behavior. The Redis Streams wiring itself (XADD/XREADGROUP/XACK)
has no automated test - same "manual verification, not automated"
convention as `RedisRoomRepository`/`ScyllaMessageHistoryRepository` -
but was manually verified against a real Redis instance during
implementation (happy path: enqueue -> consume -> persist round trip;
failure path: always-failing persist -> dead-lettered after max
attempts), not just asserted. See docker-compose.yml's top comment for
how to re-verify (including the HA story: stop Scylla, confirm the
backlog queues in Redis and drains once Scylla returns, with no server
restart).

## Task 4 - Load Balancing

Use Nginx or HAProxy for load balancing across multiple chat servers to distribute incoming traffic and improve performance.

Priority: Medium
Completed: [x]

Acceptance criteria:
- [x] Multiple chat servers handling concurrent connections.

See docker-compose.yml (3 @chatme/server replicas behind nginx.conf) and
docs/adr/2026-08-09-horizontal-scaling.md. Client connects with
`transports: ["websocket"]` only (apps/client/src/components/Chat.vue),
so plain round-robin is safe without sticky sessions. Verified manually
with `docker compose up --build`: two socket.io-client connections
through Nginx landed on different server replicas and still exchanged
messages correctly via the Redis adapter — see the ADR's Verification
section (also caught and fixed a real image-build race in
docker-compose.yml's original YAML-anchor setup).

## Task 5 - Authentication

Replace the free-text nickname flow (Join.vue) with real accounts, as a
prerequisite for Task 2 (chat history needs a stable identity to persist
against) and to finish Task 1 (session management).

Priority: Medium
Completed: [x] Better Auth + Postgres wired end-to-end: server mounts
Better Auth at `/api/auth` (`apps/server/src/infra/auth/`), signup/login UI
replaces `Join.vue` (`apps/client/src/components/auth/`), `/room` and
`/chat/:room` are guarded by session (`apps/client/src/router.ts`),
`Chat.vue` sources identity from the session instead of the removed
`:username` route param, and the Socket.IO handshake itself is verified
(`apps/server/src/presentation/socketAuth.ts` calls Better Auth's
`getSession()` against the handshake's cookie header via an `io.use()`
middleware, rejecting unauthenticated connections before `SocketController`
ever sees them — cookie-based rather than the bearer/jwt plugin the ADR
floated, since every replica already talks to the same Postgres, so a
`getSession()` lookup per connect is cheap and needs no extra token
issuance/refresh machinery). `join`/`sendMessage` no longer accept a
client-supplied username at all; it comes from the verified session.

Still open: revisiting `SocketController`'s (now-removed) username-in-use
check doesn't fully hold — `name` isn't unique the way `email` is, so two
accounts could share a display name. Not addressed here; flagging for a
future pass if it matters at this app's scale.

Decision recorded in docs/adr/2026-08-09-authentication.md: Better Auth
(not Firebase or Auth.js) + PostgreSQL, accounts mandatory (no anonymous
join).

## Task 6 - Bootstrap

Priority: Medium
Completed: [ ]

Right now when we create the app we are instantiating all the services in a single file (createApp.ts). We should have a bootstrap setup that will instantiate all the services and wire them together. This will make it easier to test and maintain the codebase. Use dependency injection whenever possible.

## Task 7 - Logout

Priority: High
Completed: [ ]

User's can login/signup but there is no way to logout. We should implement a logout functionality and a clean UI so the user can logout from the app and go back in.

## Task 8 - Presence

Priority: Medium
Completed: [x] Re-keyed the room roster from `socketId` to `(room,
username)` membership (`RoomRepository`, see
`apps/server/src/infra/rooms/`) so a disconnect flips an `online` flag
instead of deleting the record — the sidebar can now show an
offline indicator instead of losing the user entirely.
`SocketController.onJoinRoom` broadcasts the "has joined" message only
when `addUser` reports a first-ever join to that room; `onDisconnect` no
longer emits a "has left" message at all, only a `roomData` refresh
reflecting the offline flag. `Chat.vue`'s sidebar renders a colored dot
plus screen-reader-only "online"/"offline" text per user, styled with
two new oklch tokens (`--online`/`--offline` in `global.css`) per this
repo's no-hardcoded-colors convention. Decision and full reasoning in
docs/adr/2026-08-12-presence-indicators.md.

Tested: `SocketController.test.ts` and `chatFlow.integration.test.ts`
cover first-join-only broadcasting, a returning user flipping back
online without a duplicate "has joined" message, and disconnect
flipping offline without a "has left" message. `e2e/chat.spec.ts`
covers the same over a real browser + socket.io wire.

Acceptance criteria:
- [x] Online/offline indicator in the sidebar user list.
- [x] "User X joined" shown only on a user's first-ever join to a room;
      subsequent (re)connects only update the online indicator.

## Task 9 - Individual services (SKIP FOR NOW)

- Chat service (stateful service, provides the websocket connection by facilitating message sending/receiving)
- Authentication service
- Room management service
- User profile service
- Service discovery service (Apache Zookeeper)
