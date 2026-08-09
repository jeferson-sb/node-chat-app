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
Completed: [ ]

Acceptance criteria:
- [ ] Users can see their previous chat history when they log back in.

## Task 3 - Scalability with Message Queue

Use Redis/RabbitMQ for message queueing to handle high traffic and ensure messages are delivered in order and for routing between nodes

Priority: Medium
Completed: [ ]

## Task 4 - Load Balancing

Use Nginx or HAProxy for load balancing across multiple chat servers to distribute incoming traffic and improve performance.

Priority: Medium
Completed: [x]

Acceptance criteria:
- [x] Multiple chat servers handling concurrent connections.

See docker-compose.yml (3 @chatme/server replicas behind nginx.conf) and
docs/adr/2026-08-09-modernize-stack.md ("Task 4 — Horizontal scaling").
Client connects with `transports: ["websocket"]` only
(apps/client/src/components/Chat.vue), so plain round-robin is safe
without sticky sessions. Verify locally with `docker compose up --build`
(couldn't be run in the sandbox this was implemented in — see the ADR's
Consequences section).
