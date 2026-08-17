# Private rooms with a server-validated 6-digit access code

- Status: Accepted
- Date: 2026-08-16

## Context

`docs/TASK_TRACKER.md` Task 12 asks for private rooms: a creator picks
public/private when a room is made, and a private room can only be
joined by someone who supplies the matching 6-digit code.

Today a room isn't really "created" as a distinct step - the first
socket to `join` a room name implicitly brings it into existence
(`SocketController.onJoinRoom`, `apps/server/src/presentation/
controllers/SocketController.ts`), and `RoomPicker.vue` just lets the
user type any name and navigates to `/chat/:room`, which immediately
emits `join`. There's no separate "does this room exist, and is it
private" lookup the client could call before deciding what to show -
and there's no room-level configuration store at all today,
`RoomRepository` only tracks (room, username) *membership* (`docs/adr/
2026-08-12-presence-indicators.md`).

Two things had to be designed against that shape rather than an
idealized one with an explicit "create room" step:

- Where does visibility/code live, given rooms aren't created up front.
- How does the client know to show a code prompt, given it can't check
  a room's visibility before attempting to join it.

## Decision

**Room visibility is decided on first join, not on a separate "create"
step, and persisted as a small `RoomConfig` next to (not inside) the
existing membership store.**

```ts
// apps/server/src/domain/Room.ts
type RoomVisibility = 'public' | 'private';
type RoomConfig = { room: string; visibility: RoomVisibility; code?: string };
type RoomConfigLookup = { config: RoomConfig; created: boolean };
```

`RoomRepository` (both `InMemoryRoomRepository` and
`RedisRoomRepository`) gains one method:

```ts
getOrCreateRoomConfig(config: RoomConfig): Promise<RoomConfigLookup>;
```

A candidate `RoomConfig` is passed in (visibility the client requested,
plus a freshly generated code if that visibility is `'private'` -
`generateRoomCode()` in `domain/Room.ts`, zero-padded to exactly 6
digits). The repository atomically claims it if no config exists yet for
that room name, or hands back the config that already won - a room's
visibility is decided once, by whoever gets there first, and every later
join (including one requesting a different visibility) is bound by it.
`RedisRoomRepository` uses `HSETNX` on a new `chatme:room-config` hash
for this, so the same guarantee holds across every server node behind
Nginx (`docs/adr/2026-08-09-horizontal-scaling.md`), not just within one
process. `created` on the result tells `SocketController.onJoinRoom`
whether *this* join is the one that just created the room - the creator
can't possibly have supplied the code they haven't been told yet, so the
code check below only applies when `created` is false.

**Code validation is a `SocketController.onJoinRoom` guard, entirely
server-side.** `JoinRoomPayload` gains two optional fields,
`visibility` (only consulted for a room's first-ever join) and `code`.
After resolving the room's config:

```ts
if (!created && roomConfig.visibility === 'private' && roomConfig.code !== code) {
  throw new InvalidRoomCodeError(...);
}
```

`InvalidRoomCodeError` (`domain/errors/InvalidRoomCodeError.ts`) follows
the existing `DomainError` hierarchy (`docs/adr/2026-08-14-logging-and-
domain-errors.md`) exactly like `RoomNotFoundError`/`ValidationError` -
`handleSocketEvent` already turns any `DomainError` into a client-facing
`error` socket event carrying `{ code, message }`, so no new plumbing
was needed there. One error covers both "no code supplied" and "wrong
code," distinguished only by message wording, since both are the same
failure from the client's perspective: not authorized to join yet.

**The code is echoed back to the joining socket, never broadcast to the
room**, via a new `privateRoomCode` event (`eventTypes.ts`), sent once
the code check (if any) has passed:

```ts
socket.emit(eventTypes.privateRoomCode, { room, code: roomConfig.code });
```

This is deliberately unconditional on `created` - it fires for the
creator (who has no other way to learn the code to share it) *and* for
any later joiner who supplied the correct code (who, by definition,
already knew it - re-displaying it is redundant, not a leak). This
avoids a second, creator-only signal/event just to solve half the
problem.

**Client: no separate "create room" screen.** `RoomPicker.vue` adds a
public/private radio (default public); on submit, `'private'` is
appended as a `?visibility=private` query param on the `/chat/:room`
navigation (`public`, being the common case, is left off the URL rather
than always appending `?visibility=public`). `Chat.vue` reads that query
param once on mount and includes `visibility: 'private'` in its first
`join` emit only when it was requested - the server still ignores it for
a room that already exists, so this is purely "what to request if I'm
the one creating it."

**Client: the code prompt is a rejection-driven gate, not a pre-check.**
There's no "is this room private" lookup before joining - `Chat.vue`
always attempts `join` first. If the server answers with an
`INVALID_ROOM_CODE` error, a new `RoomCodeGate.vue` component (styled by
its parent, `Chat.vue`, the same shell/child split `AuthPage.vue` uses
for `LoginForm`/`SignupForm`) replaces the chat UI and asks for a code;
submitting it re-emits `join` with that code. There's no dedicated
"joined" acknowledgment event - `Chat.vue` treats the first `history`
event (which `onJoinRoom` only ever emits after every check has passed)
as the join-succeeded signal that dismisses the gate. This reuses an
event that already exists on every successful join instead of adding a
new one solely to signal success.

## Consequences

- A room's visibility, once set, cannot be changed later by design -
  matches the acceptance criteria (visibility is a creation-time choice)
  and avoids questions this task doesn't ask (who's allowed to change
  it, what happens to existing members if it does).
- `RoomRepository.getOrCreateRoomConfig` is called on *every* join, even
  to a plain public room, so `chatme:room-config` gets an entry per room
  ever joined, same never-shrinks-back precedent already accepted for
  `chatme:members` (`docs/adr/2026-08-12-presence-indicators.md`).
- The 6-digit code is generated with `crypto.randomInt`, not
  `Math.random`. This is not defence-in-depth caution: creators are
  shown their own room's code, so `Math.random` would let a caller
  create rooms to farm outputs from the shared PRNG stream, recover
  V8's internal xorshift128+ state, and *derive* other rooms' codes
  instead of guessing them - collapsing the 10^6 space to a
  computation. `randomInt` costs nothing extra and removes the class.
- The code is compared with a plain `!==`, not a constant-time compare.
  Accepted: a timing side-channel over a network socket, against a
  6-digit numeric secret, is not a practical way to recover the code
  when online guessing is the cheaper attack (see below).
- No rate limiting on repeated wrong-code join attempts, so the 10^6
  code space is open to online enumeration over a live socket. Not
  required by the acceptance criteria and out of scope here, but this
  is the real remaining weakness in the access-code design - it should
  be closed (per-socket/IP attempt throttling or lockout on repeated
  `INVALID_ROOM_CODE`) before private rooms are exposed to untrusted
  users. Flagged as a deliberate gap, not an oversight.
- `RedisRoomRepository.getOrCreateRoomConfig` has no automated test
  against a real Redis, same precedent already established for this
  class's other methods and for `RedisReadCursorRepository`
  (`docs/adr/2026-08-09-horizontal-scaling.md`) - manually verified
  against docker-compose instead. `InMemoryRoomRepository`'s
  implementation of the same method *is* covered
  (`InMemoryRoomRepository.test.ts`), and `SocketController.test.ts`
  exercises the full create/validate/reject flow against the real
  in-memory repository.
- `Chat.vue`'s new `error` listener only reacts to `INVALID_ROOM_CODE`
  and ignores every other code. The ADR that introduced domain errors
  over Socket.io already flagged "the client doesn't yet listen for
  `error`" as follow-up work; this change is that follow-up, but scoped
  narrowly to what Task 12 needs rather than building a generic
  error-toast system as a side effect.

## Alternatives considered

- **A dedicated "create room" flow/route, with room existence checked
  before joining**: would let the client show the code prompt
  pre-emptively instead of after a rejected join, and would make
  "creating" an explicit, discoverable action. Rejected as out of scope:
  it would mean designing and building a rooms-listing/lookup surface
  that doesn't exist today, well beyond what Task 12's acceptance
  criteria ask for, and it changes the implicit-creation model the rest
  of the app (and Task 13's work, running concurrently against the same
  files) is built around.
- **Store visibility/code on `ChatUser`/inside the membership hash**
  instead of a separate `RoomConfig`: would reuse `RoomRepository`'s
  existing storage instead of adding a hash. Rejected because visibility
  is a property of the *room*, not of any one member - storing it
  per-membership would mean either duplicating it across every member
  record (inconsistency risk if they ever diverged) or picking one
  arbitrary member's record to special-case as "the room's config,"
  neither of which is as direct as a room-keyed store.
- **Return only the winning `RoomConfig` from `getOrCreateRoomConfig`
  (no `created` flag), and skip the code check for a request that
  didn't include a `code` field at all** (`code === undefined` meaning
  "I might be creating"): breaks precisely for a legitimate case - a
  second/returning joiner to an already-existing private room who
  simply hasn't been prompted yet (e.g. rejoining without the client
  having cached the code) would also send no `code`, and this
  alternative would let them straight in. The `created` flag is the only
  way to distinguish "this join is what created the room" from "this
  join is against a room that already existed," so it was added instead
  of inferring intent from the payload shape.
- **A single generic error-toast/listener in `Chat.vue`** instead of one
  narrowly scoped to `INVALID_ROOM_CODE`: would also surface
  `RoomNotFoundError`/generic failures to the user, which is arguably
  overdue, but is a separate UX decision (toast placement, dismissal,
  whether every code deserves a client-facing message) that this task's
  scope doesn't require settling.
