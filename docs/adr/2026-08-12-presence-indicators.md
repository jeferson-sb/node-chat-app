# Presence indicators replace join/leave chat messages

- Status: Accepted
- Date: 2026-08-12

## Context

`docs/TASK_TRACKER.md` Task 8 asks to stop showing "User X joined"/"User X
left" as chat messages on every connect/disconnect, and instead show an
online/offline indicator in the sidebar user list — except the *first*
time a user ever joins a given room, which should still get the "User X
joined" message.

Today, `SocketController` (`apps/server/src/presentation/controllers/
SocketController.ts`) treats the room roster as purely a set of currently-
connected sockets: `onJoinRoom` calls `rooms.addUser(...)` and always
broadcasts a "has joined" message; `onDisconnect` calls
`rooms.removeUser(socket.id)`, which deletes the roster entry outright,
and always broadcasts a "has left" message. `RoomRepository`
(`apps/server/src/infra/rooms/RoomRepository.ts`, with
`InMemoryRoomRepository`/`RedisRoomRepository` implementations from
`docs/adr/2026-08-09-horizontal-scaling.md`) is keyed by `socketId`, so
there is no memory of a user once their socket disconnects — exactly the
per-node/per-connection amnesia this task needs to fix.

This task therefore needs two things the current model doesn't have:
1. A way to know whether a `(room, username)` pair has ever joined before
   ("first-ever join"), which must survive the user disconnecting (and,
   per the existing horizontal-scaling story, be visible to every server
   node — a Redis-backed store, not per-process memory).
2. A way to keep a user's sidebar entry around after they disconnect, so
   it can flip to an "offline" indicator instead of disappearing.

Both point at the same underlying fix: the roster's primary identity
should be **room membership** (`(room, username)`), not **a live
connection** (`socketId`). A live connection is just an `online: true`
state on top of that membership.

## Decision

**Re-key the room roster from `socketId` to `(room, username)`,** and add
an `online: boolean` field to `ChatUser`
(`apps/server/src/domain/ChatUser.ts`). A membership record is created
the first time a user joins a room and is updated in place — never
deleted — on every subsequent join or disconnect. "First-ever join" is
simply "no membership record existed yet for this `(room, username)`."

`RoomRepository`'s interface changes to reflect this (same method names,
new signatures/semantics — kept the same two socket lifecycle hooks
`SocketController` already calls, to minimize the diff):

- `addUser(user: ChatUser): Promise<boolean>` — was `Promise<void>`.
  Upserts the `(room, username)` membership record with `online: true`
  and the caller's current `socketId`, and returns `true` only if this is
  the user's first-ever join to that room (i.e. no prior record existed).
- `removeUser(socketId: string): Promise<ChatUser | undefined>` renamed
  to **`markUserOffline(socketId: string)`**, since it no longer removes
  anything — it flips the matching membership's `online` to `false` and
  returns that (now-offline) user, or `undefined` if the socket wasn't
  tracked (e.g. a duplicate/late disconnect event).
- `findUserByUsername`/`getUsersInRoom` keep their names and shapes but
  now read from the membership store. `findUserByUsername` only matches
  **online** members — it's used by `onSendMessage` to find which room a
  live sender is currently posting from, and an offline record (possibly
  in a different room they joined long ago) must not be mistaken for
  that.

Because membership is keyed by `(room, username)` but disconnects only
give us a `socketId`, both implementations keep a small secondary index
(`socketId -> "room:username"`) purely to resolve `markUserOffline`.
`InMemoryRoomRepository` uses a second `Map`; `RedisRoomRepository` adds
a second hash (`chatme:socket-index`) alongside the existing
`chatme:users` hash (renamed `chatme:members` to reflect what it now
holds). Same `hset`/`hget`/`hdel`/`hgetall` shape as before, so no new
Redis capability is introduced — this mirrors the existing "fine at this
app's scale" O(n) `hgetall` scan the horizontal-scaling ADR already
accepted for this store.

**`SocketController` changes:**
- `onJoinRoom`: still always emits the personal `Admin` welcome message
  and always re-broadcasts `roomData` (so a returning user's online flip
  reaches everyone immediately). The room-wide "`X` has joined the chat!"
  `message` event is now conditional on `addUser`'s return value —
  emitted only on a first-ever join.
- `onDisconnect`: no longer emits any chat message. It calls
  `markUserOffline`, then re-broadcasts `roomData` so the sidebar can flip
  that user to offline. The "has left the chat!" message is removed
  entirely, per the task description (this is exactly what an
  online/offline indicator replaces).

**Client (`Chat.vue`):** `ChatUser` gains `online: boolean` (mirroring the
server type). Sidebar `<li>`s render an indicator (a small dot + visually-
hidden text for screen readers) driven by `user.online`, using two new
oklch-based CSS custom properties (`--online`/`--offline`) added to
`global.css` alongside the existing tokens, per this repo's "no hardcoded
colors" convention for new styles — the surrounding hex-based tokens are
left untouched since they're unrelated to this task.

## Consequences

- Room membership records are **never deleted**. A user who joins a room
  once will always have a sidebar entry there — online or offline —
  indefinitely. This is an intentional trade-off (the whole point is to
  stop losing "has this user been here before" on disconnect) but it does
  mean unbounded growth of the `chatme:members` hash and of
  `InMemoryRoomRepository`'s map over the life of a long-running process,
  same category of accepted risk as the existing O(n) scan the
  horizontal-scaling ADR already signed off on for this store. Revisit
  (e.g. TTL/eviction for rooms with many one-time visitors) if this
  matters at a larger scale than this app currently targets.
- `findUserByUsername` scans for an **online** match; if a bug ever left
  a user's membership stuck `online: true` after an unclean disconnect
  (e.g. process crash without a `disconnect` event), `onSendMessage`
  would still route their messages using that stale record. This was
  already an implicit risk before this change (a crashed process never
  fired `removeUser` either) — unchanged in kind, not introduced by this
  ADR.
- No automated test covers the real Redis-backed path (`RedisRoomRepository`
  against a live Redis) end-to-end for this feature — same "DI seam for
  unit/integration tests, manual verification against docker-compose"
  convention as `docs/adr/2026-08-09-horizontal-scaling.md`. Manually
  verified locally against a running Redis instance (see
  `SocketController.test.ts`/`chatFlow.integration.test.ts` for the
  automated coverage, all against `InMemoryRoomRepository`).

## Alternatives considered

- **A separate "has ever joined" set alongside the untouched, still-
  socketId-keyed live roster** (e.g. a Redis Set of `room:username`
  strings, checked/updated independently of the existing hash): keeps the
  live-connection table exactly as it was, avoids re-keying it. Rejected
  because it still deletes the roster entry on disconnect, so the sidebar
  would have nothing to render as "offline" for a disconnected user
  without *also* keeping a persistent per-user record — at which point
  it's simpler to have one membership store double as both "have they
  joined before" and "are they online now" than to keep two stores in
  sync.
- **Track "first join" purely as a derived fact from chat history**
  (e.g. "did a join system message ever exist for this user+room in
  ScyllaDB history") instead of new roster state: avoids touching
  `RoomRepository` at all, but conflates presence state with the chat
  history store, which `docs/adr/2026-08-11-chat-history-storage.md`
  explicitly scoped to "messages in a room, by time" — presence isn't a
  message, and synthetic join messages are already deliberately excluded
  from persisted history (`SocketController.test.ts`: "does not persist
  the synthetic welcome/join messages"). Rejected; presence belongs with
  the other cross-node roster state this app already has, not history.
- **Client-only online/offline via socket connect/disconnect events**
  (no server persistence at all, just reflect the current `roomData`
  snapshot's membership one way or the other): doesn't solve "first-ever
  join" at all, since nothing would remember a user across reconnects on
  a fresh process/node. Rejected; that's the actual requirement this ADR
  addresses.
