# Chat history storage: ScyllaDB over Postgres, DynamoDB, or Cassandra

- Status: Accepted (decision only — not yet implemented, see Consequences)
- Date: 2026-08-11

## Context

`docs/TASK_TRACKER.md` Task 2 asks for persisted chat history ("Users can
see their previous chat history when they log back in"), which was
explicitly sequenced after Task 5 (authentication, see
`docs/adr/2026-08-09-authentication.md`) since history needs a stable
identity to persist against. That identity now exists — every socket
connection carries a verified Better Auth session
(`apps/server/src/presentation/socketAuth.ts`) — so Task 2 is unblocked.

Chat messages today are ephemeral: `SocketController.onSendMessage`
(`apps/server/src/presentation/controllers/SocketController.ts`) builds a
`Message` (`apps/server/src/domain/Message.ts`) and broadcasts it over the
room's socket.io channel, but nothing stores it. A disconnect or reload
loses everything.

Postgres already exists in this stack (provisioned for Better Auth), and
the obvious default would be a `messages` table there, sharing the
database the way the authentication ADR anticipated. This ADR
deliberately looks elsewhere: this project's owner wants chat history to
scale and demonstrate high availability *now*, as a proof of concept, not
deferred until Postgres write throughput or failover time becomes an
actual measured problem.

Message history's access pattern is narrow and predictable — "give me the
last N messages in room X" or "give me messages before cursor T in room
X" — a partition-by-room, sort-by-time lookup with no cross-room joins.
That shape, plus the explicit scale/HA goal, is what's evaluated below.

## Decision

Use **ScyllaDB**, self-hosted, over Postgres, DynamoDB, or vanilla
Cassandra.

**Why not Postgres:** technically capable of this workload for a long
time (time-partitioned tables, read replicas, eventually Citus), but that
conservatism is exactly what's being deliberately skipped here. Postgres
HA is replica promotion (a failover event, briefly unavailable, some risk
of losing the last unreplicated writes); horizontal write scaling needs
manual/extension-based sharding. Neither demonstrates the leaderless,
natively-horizontal story this POC is for.

**Why not DynamoDB:** technically excellent for exactly this partition
key + sort key shape, and the lowest-effort option (fully managed, zero
ops). Rejected anyway because it's AWS-only — the same reason
`docs/adr/2026-08-09-authentication.md` rejected Firebase Auth over Better
Auth: this project has deliberately stayed self-hosted and vendor-neutral
at every step (own Docker Compose stack, own Redis, own Nginx, own
Postgres, Fly.io for deploy). DynamoDB would reintroduce that exact
mismatch at the data layer.

**Why not Cassandra:** ScyllaDB is wire-compatible with Cassandra's CQL —
same data model, same query language, same Node.js driver
(`cassandra-driver`) — but reimplemented in C++ with a shard-per-core
architecture instead of Cassandra's JVM. Same leaderless-replication, HA,
and horizontal-write-scaling properties, without JVM heap/GC tuning,
using fewer nodes for the same throughput. Strictly less operational
overhead for the same decision, appropriate for a POC team without
dedicated distributed-database operations experience.

**Data model** (partition key caps unbounded partition growth — a
well-known Cassandra/Scylla pitfall for long-lived, busy rooms):

```cql
CREATE TABLE messages (
  room_id text,
  bucket int,              -- e.g. day number since a fixed epoch
  created_at timestamp,
  message_id uuid,
  username text,
  text text,
  PRIMARY KEY ((room_id, bucket), created_at, message_id)
) WITH CLUSTERING ORDER BY (created_at DESC);
```

`(room_id, bucket)` spreads writes and bounds partition size; clustering
by `created_at DESC` (with `message_id` as a tiebreaker for same-timestamp
writes) gives cheap "last N" and "before cursor T" range scans without a
secondary index — the one access pattern this table needs to serve well.

**Cluster topology:** a 3-node ScyllaDB cluster in `docker-compose.yml`
(replication factor 3), mirroring the existing 3-replica `@chatme/server`
pattern from `docs/adr/2026-08-09-horizontal-scaling.md` — the same
"kill one node mid-write, the rest keep accepting writes" story that
proves leaderless HA, rather than a single-instance stand-in.

## Consequences

- **Not implemented yet.** This ADR records the decision; implementation
  will need at minimum: a `messages` keyspace/table migration mechanism
  (Scylla/Cassandra has no single de facto migration tool the way Better
  Auth's CLI covers Postgres — likely a small script run at deploy time),
  a write path from `SocketController.onSendMessage` (only real user
  messages — not the synthetic `Admin`/`Server` join/welcome/leave
  messages), and a read path (a socket event or HTTP endpoint fetching
  the last page of history on room join, keyed by `(room_id, bucket)`
  and a `created_at` cursor for pagination).
- A fourth stateful service alongside Redis (ephemeral socket/room state)
  and Postgres (accounts) — its own deploy, backup, and monitoring
  surface, distinct from either.
- Query flexibility is intentionally narrow: no ad-hoc filtering, no
  full-text search, no joining message rows with user data server-side.
  Anything outside "messages in a room, by time" needs a new table
  designed around that access pattern, or a separate system (e.g.
  Elasticsearch) later.
- Consistency is tunable, not automatic: writes should use
  `LOCAL_QUORUM` (durability without waiting on every replica), reads for
  history can use `LOCAL_ONE` (slight staleness is a non-event here,
  since messages already arrive live over the socket — history-fetch is
  just backfill).
- No automated test will cover the Scylla-backed path until it's
  implemented; follow the same pattern as
  `docs/adr/2026-08-09-horizontal-scaling.md`'s Redis path (a DI seam in
  `createApp.ts` for tests, an integration test against a real cluster).

## Alternatives considered

- **DynamoDB**: technically the strongest fit for this exact key shape
  and the least operational effort, but AWS-only. Rejected for the same
  vendor-neutrality reasoning that rejected Firebase Auth in
  `docs/adr/2026-08-09-authentication.md`.
- **Cassandra**: identical data model and HA/scaling properties to
  ScyllaDB (Scylla is wire-compatible), but carries JVM heap/GC tuning
  and needs more nodes for equivalent throughput. Rejected in favor of
  ScyllaDB's lower operational overhead for the same architecture.
- **Postgres (partitioned table + read replicas, possibly Citus later)**:
  the conservative, lowest-new-infra option, and the one this project's
  own authentication ADR anticipated. Rejected only because the goal
  here is explicitly to scale and demonstrate HA now, as a proof of
  concept — not because Postgres would fail at this app's actual current
  load. Worth revisiting if ScyllaDB's operational cost outweighs its
  benefit at this project's real scale.
- **CockroachDB / YugabyteDB (distributed SQL)**: horizontally scalable
  and self-hostable while staying relational, avoiding a second database
  technology entirely. Rejected because it doesn't demonstrate what this
  POC is for — a storage engine chosen for its access-pattern fit, not
  "make Postgres bigger" — and generally trades some raw throughput
  per node versus a purpose-built wide-column store for this specific
  append-heavy, time-ordered workload.
- **MongoDB**: document model doesn't fit this access pattern as
  naturally as a wide-column store (no meaningful use for nested
  documents here), and its shard+config-server topology is more
  operationally fragile than Cassandra-family consistent hashing for the
  same horizontal-scaling goal. Rejected.
