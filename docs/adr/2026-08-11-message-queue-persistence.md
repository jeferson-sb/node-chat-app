# Buffer chat history persistence with Redis Streams

- Status: Accepted (decision only — not yet implemented, see Consequences)
- Date: 2026-08-11

## Context

`docs/TASK_TRACKER.md` Task 3 asks for "Redis/RabbitMQ for message
queueing to handle high traffic and ensure messages are delivered in
order and for routing between nodes." Routing between nodes is already
solved: `createApp.ts`'s `setupRooms()` wires `@socket.io/redis-adapter`
(`docs/adr/2026-08-09-horizontal-scaling.md`), so `socketServer.to(room)
.emit(...)` already fans out across every `@chatme/server` replica over
Redis pub/sub. That part of the task doesn't need new work.

What's missing is resilience around the other side of `onSendMessage`
(`apps/server/src/presentation/controllers/SocketController.ts`): it
currently does `await this.messageHistory.saveMessage(...)` synchronously,
in the same call as the broadcast. If the Scylla write throws — a
transient error, a node down, the whole cluster unreachable — the
rejection is swallowed by the `.catch(console.error)` in the socket
handler (`createApp.ts`) and the message is silently lost: never
persisted, and never broadcast either, since the throw happens before the
`emit`. There's no buffering, no retry, and a slow write stalls delivery
to everyone in the room since the emit waits on it.

## Decision

Add a **Redis Streams** queue in front of the ScyllaDB persistence write
only. Real-time delivery is untouched — it keeps going straight through
the existing Redis pub/sub adapter, unchanged.

**Flow:** `onSendMessage` validates the message (`Message.from(...)`,
still synchronous — bad input never reaches the queue), broadcasts it
immediately exactly as today, and enqueues a persistence job onto a
single stream (`chatme:messages:pending`) instead of calling
`messageHistory.saveMessage` directly. Each `@chatme/server` replica also
runs an in-process consumer in the same Redis consumer group
(`XREADGROUP`), so any replica can pick up and persist any pending
message — no new deployable unit. A consumer that crashes mid-processing
leaves its entries in the group's pending-entries list for another
consumer (or itself, on restart) to reclaim.

**Why Redis Streams over RabbitMQ:** Redis is already a dependency (the
pub/sub adapter, `RedisRoomRepository`). Streams give consumer groups
(at-least-once delivery, crash recovery via the pending-entries list) and
a durable, ordered log, without introducing new infrastructure — this
project's own conventions ("Don't add dependencies without
justification") rule out RabbitMQ when Streams already cover what's
needed.

**Why a single global stream, not one per room:** the queue only buffers
*writes*, not reads. Scylla's clustering key already determines display
order independent of write order (`created_at DESC, message_id` — see
`docs/adr/2026-08-11-chat-history-storage.md`), so two messages for the
same room being persisted out of enqueue-order is harmless; they'll still
render in the correct order when history is fetched. That removes any
need to partition the stream per room for ordering reasons, and a single
stream avoids an unbounded number of Redis keys for arbitrary,
user-chosen room names. (Live delivery order — the thing users actually
perceive as "order" — is unaffected by any of this; it's still the
existing synchronous broadcast.)

**Failure handling:** the consumer retries a failed persist with backoff
a small, fixed number of times (leaning on the pending-entries list for
crash recovery in between), then moves the entry to a separate
`chatme:messages:dead` stream and acks the original — so one
persistently-failing message (or an extended Scylla outage) doesn't stall
the whole consumer group behind it. The dead-letter stream is a visibility
mechanism (something to alert on / inspect), not an automatic recovery
path.

**Backpressure:** `chatme:messages:pending` is trimmed with an
approximate `MAXLEN` cap (generous — sized well above normal traffic) so
a sustained Scylla outage can't grow the stream — and Redis's memory —
without bound. Accepted risk: an extreme, long-enough backlog could drop
the oldest still-unpersisted messages. Consistent with this project's
existing risk posture (e.g. the in-memory `MessageHistoryRepository`
fallback already loses everything on restart) — this is a POC, not a
durability guarantee system.

**Fallback:** same graceful-degrade pattern as `setupRooms`/`REDIS_URL`
elsewhere in `createApp.ts` — when `REDIS_URL` is unset, skip the queue
entirely and call `messageHistory.saveMessage` directly and synchronously,
exactly as today. A single-process dev setup has no cross-node concern to
buffer against.

## Consequences

- **Not implemented yet.** Implementation will need at minimum: a
  `MessageQueue` interface (`enqueue(room, message): Promise<void>`) with
  `InMemoryMessageQueue` (direct passthrough to `messageHistory`, used
  when `REDIS_URL` is unset) and `RedisStreamMessageQueue`
  implementations, mirroring the existing `RoomRepository`/
  `MessageHistoryRepository` seam pattern; a consumer component started
  from `createApp.ts` alongside the other `setupX()` functions, with its
  own `close()` for graceful shutdown; and the dead-letter stream plus
  whatever minimal tooling (a log line, at minimum) makes it visible.
- `SocketController.onSendMessage` changes its persistence call from
  `messageHistory.saveMessage` to `messageQueue.enqueue`; the broadcast
  itself does not move.
- Message persistence is now eventually-consistent with real-time
  delivery rather than synchronous with it — a message can appear live in
  chat slightly before it's queryable in history. Acceptable: history-on-
  join already only matters after a reconnect, by which point the queue
  will have long since drained under normal load.
- One more Redis-backed moving part to reason about operationally
  (consumer group lag, the dead-letter stream, the `MAXLEN` trim
  threshold), on top of the pub/sub adapter and `RedisRoomRepository`
  already there.
- No automated test will cover the real Redis Streams path until it's
  implemented and, ideally, run against a real Redis instance — same
  "DI seam for unit tests, manual/integration verification against
  docker-compose for the real backend" pattern as
  `docs/adr/2026-08-09-horizontal-scaling.md` and
  `docs/adr/2026-08-11-chat-history-storage.md`.

## Alternatives considered

- **RabbitMQ**: capable, but new infrastructure (container, client
  dependency, its own operational surface) for guarantees Redis Streams
  already provide given Redis is already a hard dependency of this
  stack. Rejected for the same "don't add a dependency without
  justification" reasoning applied throughout this project.
- **Route the whole send-message pipeline through the queue** (broadcast
  *and* persistence both driven by a consumer, not just persistence):
  would unify both concerns under one ordering story, but adds a queue
  round-trip of latency before *any* client — including the sender —
  sees a message. Real-time chat latency is worth protecting; the
  broadcast path today is already correct and fast via the pub/sub
  adapter, so there's nothing to fix there. Rejected.
- **A separate worker service** consuming the stream instead of an
  in-process consumer in each server replica: cleaner separation of
  concerns, but pulls forward part of Task 6's scope (splitting into
  individual services), which hasn't been started. Rejected for now;
  worth revisiting once Task 6 is underway.
- **Retry forever on a failing message** instead of dead-lettering:
  guarantees nothing is silently discarded, but lets one broken message
  (or a long outage) stall the entire consumer group's persistence work
  indefinitely. Rejected in favor of bounded retries + dead-letter.
- **Unbounded stream** (no `MAXLEN`): zero data-loss risk from trimming,
  but an extended Scylla outage grows Redis memory without limit,
  threatening the pub/sub adapter and `RedisRoomRepository` that share
  the same Redis instance. Rejected in favor of a generous but bounded
  cap.
