# Switch rooms on click, backed by a per-user room history

- Status: Accepted
- Date: 2026-08-17

## Context

`docs/TASK_TRACKER.md` Task 14 asks for Discord-style room switching: click
a room, land in it, without a full page reload and without re-fetching a
room's entire history at once (the latter is already true today - joining
a room only ever fetches `HISTORY_LIMIT` recent messages,
`SocketController.ts`).

Two things make this less trivial than it sounds:

- `RoomRepository` (`apps/server/src/infra/rooms/RoomRepository.ts`)
  models one online membership per user at a time -
  `findUserByUsername` scans every membership for a single online match,
  and `onSendMessage` broadcasts to that one `user.room`. A user
  belonging to two rooms simultaneously is not something the roster, the
  presence broadcasts, or message routing can currently represent.
- `apps/client/src/router.ts`'s `/chat/:room` route reuses the same
  `Chat.vue` instance across two different `:room` values - Vue Router
  doesn't remount a component when only its params change - so navigating
  the URL alone would never re-trigger `onMounted`'s join logic.

## Decision

**Single active room per socket, switched by leaving then joining -** no
new "multi-room presence" model. `SocketController` gains a private
`leaveCurrentRoom(socket)`, extracted from `onDisconnect`'s existing
cleanup (`rooms.markUserOffline` -> cursor `markSeen` -> `roomData`
rebroadcast to the vacated room), plus an explicit `socket.leave(room)`
that `onDisconnect` never needed (a disconnecting socket leaves every
room automatically). `onJoinRoom` calls `leaveCurrentRoom` first, before
any of its existing logic. For a socket's very first join,
`markUserOffline` finds nothing tracked yet and no-ops, so today's join
behavior is unchanged; a second `join` for an already-connected socket
now cleanly vacates the old room before entering the new one.

No new socket event for switching - the client already has everything it
needs in `attemptJoin`/`join`. Clicking a different room is just another
`join` emit with that room's display name.

**A new, Postgres-backed `UserRoomsRepository` remembers which rooms a
user has joined,** so the client can render a clickable list without the
user having to retype room names from memory. Table `user_rooms(user_id,
room, display_name, first_joined_at, last_joined_at)`, upserted on every
successful join (`recordJoin`) and read back ordered by `first_joined_at`
(`listJoinedRooms`) - `first_joined_at` is set once, on the initial
insert, and never touched by later joins, so a room's position in the
list stays stable across repeat switches; only `last_joined_at` moves.
An earlier version of this ADR ordered by `last_joined_at` (most-recent-
first) instead - reverted after real usage showed reordering the whole
list on every click read as jumpy/confusing rather than useful, unlike
e.g. a browser's most-recent-tabs list where reordering is the point.
Postgres, not Redis or in-memory, because this is exactly the kind of
data the app already treats as durable-per-account (accounts themselves
live in Postgres via Better Auth, `docs/adr/2026-08-09-authentication.md`)
- unlike `RoomRepository`'s roster, this must survive a restart and
follow the user across devices/browsers, which rules out the
graceful-degrade-to-memory pattern used for Redis-backed services
elsewhere in this app.

Plain SQL via the existing `pg` dependency, not Kysely: Kysely is only a
devDependency today (used to build Better Auth's own migrations in
tests, `createTestAuthDatabase.ts`), and promoting it to a runtime
dependency purely for one small table isn't justified by this task.
Migrated the same way as `ScyllaMessageHistoryRepository`'s schema
(`apps/server/src/infra/history/migrate.ts`): a small idempotent script,
`db:migrate:user-rooms`, run manually or at deploy time - Better Auth's
own CLI migration only manages its own tables.

`onJoinRoom` emits a new `joinedRooms` event to the joining socket, right
after `history`, carrying that user's updated list. `Chat.vue` renders it
as a second sidebar list ("Rooms", alongside "Users"); clicking an entry
re-emits `join` for that room after clearing local `messages`/`users`
state, reusing the exact same join path a fresh page load takes.

## Consequences

- **Switching to a previously-joined private room re-prompts for its
  access code.** The code itself is never persisted (`user_rooms` only
  stores the display name), so clicking a private room in the list hits
  the same `INVALID_ROOM_CODE` gate a first-time join would. Acceptable
  for now, same "explicit, scoped decision" precedent as
  `docs/adr/2026-08-16-room-name-slugs.md`'s discarded pre-slug data -
  worth solving only if private rooms one clicks into repeatedly turns
  out to be a real usage pattern.
- **`onDisconnect` and `onJoinRoom` now share `leaveCurrentRoom`,
  slightly changing `onDisconnect`'s shape** (it delegates instead of
  inlining the same three steps) but not its observable behavior -
  covered by the existing disconnect tests continuing to pass unchanged.
- **A user can only ever be "seen" as present in one room at a time**,
  by design (see Decision) - switching rooms in one browser tab
  immediately reflects as offline in the room just left, since
  `leaveCurrentRoom` and the new join share that same socket. **Opening a
  second room in a second tab does not displace the first** - each
  socket keeps its own online membership in its own room, so the account
  ends up "present" in both at once. This surfaced a pre-existing bug in
  `onSendMessage`, which used to resolve the sending room via
  `findUserByUsername` (any online membership matching the username, the
  first one found) - with two concurrent memberships, a message sent
  from the second tab could broadcast to the first tab's room instead,
  where the second tab would never see it delivered. Fixed by resolving
  the room from the sending socket's own membership
  (`RoomRepository.findUserBySocketId`) rather than a username-wide
  search - the only lookup that can't be ambiguous, since it's keyed by
  the exact connection the message came from.

## Alternatives considered

- **True multi-room presence** (join several rooms concurrently,
  Discord's actual model): rejected for this task - it requires
  reworking `RoomRepository`'s membership key, `findUserByUsername`'s
  single-match assumption, and `onSendMessage`'s room resolution, none of
  which this "Low priority" task's scope justifies. Revisit only if a
  concrete need for simultaneous multi-room presence shows up.
- **Client-only recent-rooms list** (localStorage, no server change):
  simpler, no new table/migration, but doesn't follow the user across
  devices/browsers and is lost on cache clear. Rejected per the explicit
  choice to persist this server-side.
- **A dedicated `switchRoom` socket event** instead of reusing `join`:
  would make "this is a switch" explicit in the wire protocol, but
  `leaveCurrentRoom` already makes every `join` switch-safe regardless of
  whether the socket had a prior room, so a second event would only
  duplicate `onJoinRoom`'s logic for no behavioral difference.
