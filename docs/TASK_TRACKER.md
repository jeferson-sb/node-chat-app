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
Completed: [x] Added `LogoutButton.vue` (`apps/client/src/components/`),
rendered in `Chat.vue`'s sidebar — logout is only offered once the user
has actually entered a room, not from the room picker. Styled with the
same brand tokens (`--purple`/`--light-purple`) as the app's other
primary buttons, pinned to the bottom of the sidebar. On click it calls
the existing `authClient.signOut()` (Better Auth's Vue client, already
used for `signIn`/`signUp`/`getSession`), then `router.push('/')` on
success, or shows an inline error without navigating on failure.

No new server code was needed — Better Auth's `POST /api/auth/sign-out`
was already live via the existing `app.all('/api/auth/*splat', ...)`
mount in `createApp.ts`. Socket cleanup is likewise free: the socket is
a variable local to `Chat.vue` (not a shared service), so navigating
away from `/chat/:room` on logout unmounts `Chat.vue`, which already
calls `socket.disconnect()` in its existing `onBeforeUnmount` — no new
socket-service abstraction was introduced.

Tested: `LogoutButton.test.ts` covers all three click behaviors (calls
signOut, redirects on success, shows error and stays put on failure).
`Chat.test.ts` and `RoomPicker.test.ts` each got a light integration
check that the control renders. `auth.integration.test.ts` gained a new
case hitting the real `POST /api/auth/sign-out` endpoint and confirming
`GET /api/auth/get-session` returns null afterward with the same
cookie. Manually verified end-to-end in a browser: sign up → logout →
redirected to `/` → navigating directly back to `/room` bounces to `/`
again, confirming the session was actually invalidated server-side, not
just a client-side redirect.

Known gap, addressed: `socketAuth.ts` used to only check the session
cookie once, at connect time — if a tab was logged out but its socket
stayed open (e.g. logout triggered from a different tab), that
connection wasn't proactively dropped by the server. Now
`requireAuthenticatedSocket` re-verifies the same session every 30s
(configurable via `sessionCheckIntervalMs`) for as long as the socket
stays open, and calls `socket.disconnect(true)` the moment the session
comes back invalid.

## Task 8 - Presence

Priority: Medium
Completed: [ ]

Instead of showing "User X joined" and "User x left" messages, what about adding a online/offline indicator at the Users chat list/sidebar?
We only need to show "User X joined" when is the first time the user has joined that room. After that, we should only show the online/offline indicator.

## Task 9 - Individual services (SKIP FOR NOW)

- Chat service (stateful service, provides the websocket connection by facilitating message sending/receiving)
- Authentication service
- Room management service
- User profile service
- Service discovery service (Apache Zookeeper)
