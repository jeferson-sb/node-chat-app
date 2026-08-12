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
Completed: [~] Partial — Redis-backed room roster (Task 4) covers the
sidebar user list and username-uniqueness across nodes. Actual user
sessions (auth, reconnect-with-history) are still out of scope.

## Task 2 - Chat persistance

Priority: Medium
Completed: [~] Partial — ScyllaDB-backed message history wired end-to-end,
with an in-memory fallback when Scylla isn't configured. Not yet verified
against a real multi-node Scylla cluster (dev machine lacks the RAM).

Acceptance criteria:
- [x] Users can see their previous chat history when they log back in.

## Task 3 - Scalability with Message Queue

Use Redis/RabbitMQ for message queueing to handle high traffic and ensure messages are delivered in order and for routing between nodes

Priority: Medium
Completed: [x] Added a Redis Streams queue so a message broadcasts
immediately and its history write happens async, with retry and
dead-lettering on repeated failure. Falls back to a synchronous
in-memory queue when Redis isn't configured.

## Task 4 - Load Balancing

Use Nginx or HAProxy for load balancing across multiple chat servers to distribute incoming traffic and improve performance.

Priority: Medium
Completed: [x]

Acceptance criteria:
- [x] Multiple chat servers handling concurrent connections.

## Task 5 - Authentication

Replace the free-text nickname flow (Join.vue) with real accounts, as a
prerequisite for Task 2 (chat history needs a stable identity to persist
against) and to finish Task 1 (session management).

Priority: Medium
Completed: [x] Better Auth + Postgres wired end-to-end: signup/login UI,
route guards, and Socket.IO handshake verification all source identity
from the session instead of client-supplied input.

## Task 6 - Bootstrap

Priority: Medium
Completed: [x] Extracted service instantiation (rooms, auth database,
message history, message queue) out of `createApp.ts` into a new
`bootstrap.ts` composition root. `createApp.ts` now only wires already-
resolved services into Express/Socket.io.

Acceptance criteria:
- [x] Service instantiation and app wiring live in separate modules.
- [x] Each service can be overridden for tests (not just the database).

## Task 7 - Logout

Priority: High
Completed: [x] Added a logout button that calls Better Auth's `signOut()`
and redirects to `/`. Socket connections now re-check the session every
30s so logging out from another tab also disconnects them.

Acceptance criteria:
- [x] User can log out from the chat UI and return to sign-in.
- [x] Logging out invalidates the session server-side, not just client-side.

## Task 8 - Presence

Priority: Medium
Completed: [x] Room roster now tracks online/offline per user instead of
deleting the record on disconnect. "Has joined" message only shows on a
user's first-ever join to a room.

Acceptance criteria:
- [x] Online/offline indicator in the sidebar user list.
- [x] "User X joined" shown only on first-ever join; later (re)connects
      only update the indicator.

## Task 9 - Individual services (SKIP FOR NOW)

- Chat service (stateful service, provides the websocket connection by facilitating message sending/receiving)
- Authentication service
- Room management service
- User profile service
- Service discovery service (Apache Zookeeper)

## Task 10 - Offline delivery

Messages sent while a user is offline are delivered on reconnect.
