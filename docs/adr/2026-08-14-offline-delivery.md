# Deliver missed messages on reconnect via a per-(room, username) read cursor

- Status: Accepted, amended by
  [The `history` event carries a snapshot, not a delta](2026-08-15-history-snapshot-on-join.md)
- Date: 2026-08-14

## Context

`docs/TASK_TRACKER.md` Task 10 asks that messages sent while a user is
offline be delivered on reconnect. Today, `SocketController.onJoinRoom`
(`apps/server/src/presentation/controllers/SocketController.ts`) always
calls `messageHistory.getRecentMessages(room, HISTORY_LIMIT)` (50) and
emits that fixed window as `eventTypes.history`, regardless of whether
the joining user is brand new to the room or reconnecting after a short
disconnect. This approximates offline delivery for a quiet room, but:

- A user offline through more than 50 messages of room activity loses
  everything before that window.
- A user reconnecting after missing only a couple of messages gets the
  same full 50-message replace as a first-time joiner - redundant, and
  wasteful for a busy room.

Task 8 (`docs/adr/2026-08-12-presence-indicators.md`) already solved a
structurally similar problem: it re-keyed the room roster from `socketId`
to `(room, username)` so membership - and now `online` state - survives
a disconnect. This task needs the same shape of persistent, per-
`(room, username)` state, but for "what has this user already seen"
rather than "is this user currently connected."

## Decision

**Add a new `ReadCursorRepository`**
(`apps/server/src/infra/cursor/ReadCursorRepository.ts`), keyed by
`(room, username)` like `RoomRepository`, but kept as its own store
rather than folded into `ChatUser`/`RoomRepository` - presence
(`online`) and delivery progress (`lastSeenAt`) are different concerns
that happen to share a key, not the same piece of state.

```ts
type ReadCursorRepository = {
  getLastSeenAt(room: string, username: string): Promise<number | undefined>;
  markSeen(room: string, username: string, seenAt: number): Promise<void>;
};
```

The cursor is a single timestamp (the newest message's `createdAt` the
user has already seen), not a message id - `MessageHistoryRepository`'s
storage is already ordered/queried by `created_at` (Scylla's clustering
key, `docs/adr/2026-08-11-chat-history-storage.md`), so a timestamp
cursor maps directly onto an existing index instead of requiring a new
one.

**`MessageHistoryRepository` gains `getMessagesSince(room, sinceAt,
limit)`**, returning messages with `createdAt > sinceAt`, newest first,
capped at `limit` - same contract shape as the existing
`getRecentMessages`. Implemented in both `InMemoryMessageHistoryRepository`
(array filter) and `ScyllaMessageHistoryRepository` (same bucket-walk as
`getRecentMessages`, but bounded by `sinceAt`'s own bucket instead of the
fixed `BUCKET_LOOKBACK`, since a cursor is always a real prior
timestamp rather than an unbounded scan).

**`SocketController.onJoinRoom`** now reads the cursor first:

- No cursor (first-ever join, or Redis not configured - see below): same
  as today, `getRecentMessages(room, HISTORY_LIMIT)`.
- A cursor exists: `getMessagesSince(room, lastSeenAt, HISTORY_LIMIT)` -
  only what was missed, still capped at the same limit. If a user missed
  more than the cap, the excess is silently dropped (no "N messages not
  shown" indicator) - same silent-cap precedent as the existing fixed
  window, and avoids a client-side change for this task.

After emitting, if any messages were delivered, the cursor advances to
the newest delivered message's `createdAt`.

**`SocketController.onDisconnect`** *also* advances the cursor, to
`Date.now()`, whenever a known user goes offline. This is necessary, not
redundant: everything broadcast live between join and disconnect was
already seen by a connected user, but the cursor is only otherwise
touched at join. Without also advancing it at disconnect, the *next*
reconnect's `getMessagesSince` would use a stale, join-time cursor and
redeliver the entire prior session's live traffic as "missed."

**Deliberately Redis-only.** Unlike `RoomRepository`/
`MessageHistoryRepository`/`MessageQueue`, there is no working
single-process fallback implementation. Without `REDIS_URL`,
`bootstrap.ts` wires a `NullReadCursorRepository` whose `getLastSeenAt`
always returns `undefined` - offline delivery is disabled outright (the
existing fixed-window behavior is retained), rather than gaining an
in-memory cursor that wouldn't survive a restart or be shared across
server nodes behind the load balancer (`docs/adr/2026-08-09-horizontal-
scaling.md`). A cursor that silently doesn't persist or doesn't match
across nodes would misbehave in ways worse than the feature simply being
off. `RedisReadCursorRepository` stores `chatme:read-cursors`
("room:username" -> lastSeenAt), same hash shape as
`RedisRoomRepository`'s membership store.

## Consequences

- **Known race with async persistence** (accepted, not solved): Task 3's
  message queue broadcasts a message immediately and persists it to
  `messageHistory` asynchronously (`docs/adr/2026-08-11-message-queue-
  persistence.md`). A message sent to a room right as an offline user
  reconnects may still be sitting in the Redis stream, not yet queryable
  via `getMessagesSince`. This is the same eventual-consistency tradeoff
  that ADR already accepts for history fetches in general; closing this
  gap would mean either synchronous persistence or also scanning the
  pending stream on join, undoing Task 3's design for a narrow race
  window. Not addressed here.
- **No automated test covers `RedisReadCursorRepository` against a real
  Redis** - same precedent as `RedisRoomRepository`
  (`docs/adr/2026-08-09-horizontal-scaling.md`): a DI seam
  (`ReadCursorRepository`) for unit/integration tests (fakes defined
  locally in `SocketController.test.ts` and `chatFlow.integration.test.ts`,
  not a shared in-memory production class - see "Deliberately Redis-
  only" above), manual verification against docker-compose for the real
  path.
- **Cursor storage grows unboundedly**, one entry per `(room, username)`
  that has ever joined - same accepted tradeoff as the never-deleted
  `chatme:members` hash (`docs/adr/2026-08-12-presence-indicators.md`).
- If a user is offline long enough that ScyllaDB's bucket lookback in
  `getMessagesSince` would need to scan many weekly buckets to reach
  their cursor, that's a wider scan than `getRecentMessages`'s fixed
  `BUCKET_LOOKBACK` - bounded in practice by how stale a cursor can
  realistically get (an active account reconnecting), not by an
  arbitrary constant.

## Alternatives considered

- **Store `lastSeenAt` directly on `ChatUser`/`RoomRepository`** instead
  of a separate `ReadCursorRepository`: reuses an existing store and key
  shape instead of introducing a new one. Rejected in favor of a
  dedicated store - presence (are they connected right now) and read
  progress (what have they seen) are different lifecycles that happen to
  share a key, and conflating them would mean every future presence-only
  change also has to reason about delivery-cursor correctness, and vice
  versa.
- **In-memory fallback for `ReadCursorRepository`**, matching every other
  repository's graceful-degrade pattern: rejected because a cursor that
  resets on restart or isn't shared across nodes doesn't degrade
  gracefully, it produces confusing partial behavior (e.g. one node
  correctly withholds already-seen messages, another replays all of
  them) - worse than the feature being cleanly off without Redis.
- **Message-id-based cursor** instead of a timestamp: would need
  `MessageHistoryRepository` to support "give me everything after this
  specific id," which Scylla's `created_at`-ordered clustering key
  doesn't directly support without also storing/looking up that message's
  timestamp first. A timestamp cursor gets the same effective behavior
  (ties are not a practical concern at this app's message-send rate)
  while mapping onto storage that already exists.
- **Client-side ack advancing the cursor only after rendering** (a new
  `historyReceived` event) instead of advancing on join: more precisely
  tied to "the user actually saw this," but adds a new event, a new
  failure mode (ack never arrives, e.g. a tab closed mid-render), and
  client changes beyond consuming the existing `history` payload.
  Rejected for this task; the on-join/on-disconnect model already covers
  the actual requirement (delivered on reconnect) without it.
