# Split room identity into a display name and a deterministic slug

- Status: Accepted
- Date: 2026-08-16

## Context

`docs/TASK_TRACKER.md` Task 13 asks for rooms to have a user-facing
display name (e.g. "CS Study Group") and a "parsed name" - a readable,
URL-safe identifier the backend uses internally - derived from it (e.g.
`cs-study-group-<hash>`).

Today there is no such split. A "room" is whatever raw string a client
sends: typed freely into `RoomPicker.vue`
(`apps/client/src/components/RoomPicker.vue`), carried unchanged through
the `/chat/:room` route (`apps/client/src/router.ts`), and forwarded
as-is in the `join` payload's `room` field
(`SocketController.onJoinRoom`,
`apps/server/src/presentation/controllers/SocketController.ts`). That
same raw string is then used directly as:

- the Socket.io room (`socket.join(room)`),
- the room-roster key (`RoomRepository`'s `` `${room}:${username}` ``
  membership key, `apps/server/src/infra/rooms/RoomRepository.ts`),
- the message-history partition key (`MessageHistoryRepository`), and
- the read-cursor key (`ReadCursorRepository`,
  `docs/adr/2026-08-14-offline-delivery.md`).

None of these internal services benefit from a name that can contain
spaces, mixed case, punctuation, emoji, or non-ASCII scripts - at best
it's cosmetically inconsistent (`"CS Study Group"` vs `"cs study group"`
being treated as different rooms today), at worst it's an unsafe or
awkward key for a URL segment, a Redis key, or `console.table` output
(`inspectRoomState.ts`).

## Decision

**Add `slugifyRoomName`**
(`apps/server/src/domain/slugifyRoomName.ts`), a pure function turning a
display name into `<readable-prefix>-<hash>` (or just `<hash>` if no
alphanumeric characters survive):

- The **prefix** is built by Unicode-decomposing the name (`NFKD`),
  dropping combining diacritical marks (café -> cafe), lowercasing, and
  discarding everything that isn't an ASCII letter, digit, or whitespace
  - punctuation, symbols, emoji, non-Latin scripts are all stripped
    outright, per the task's "only accept numbers and chars from the
    display name" rule. Words are joined with single hyphens and capped
    at 60 characters so an unusually long display name can't produce an
    unbounded key.
- The **hash** is the first 8 hex characters of
  `sha256(displayName.trim().toLowerCase().replace(/\s+/g, ' '))` -
  computed from the name only trimmed/case/whitespace-normalized, not
  stripped of diacritics/punctuation/emoji. This is deliberate: it's what
  lets two display names that reduce to the *same* prefix but are
  actually different text (`"Café"` vs `"Cafe"`, `"🎉 General"` vs
  `"General"`) still resolve to different slugs, instead of two
  unrelated rooms silently merging.
- The hash is **deterministic**, not random or creation-order-based:
  the same (trimmed/cased/whitespace-normalized) display name always
  produces the same slug, on any node, with no shared lookup table
  needed to resolve it. sha256 (via `node:crypto`, no new dependency)
  was chosen over a non-cryptographic hash purely for convenient
  availability and good bit distribution at this truncated length -
  collision resistance beyond "good enough to disambiguate a chat app's
  room names" was never a goal.
- The result always matches `/^[a-z0-9]+(-[a-z0-9]+)*$/` - always
  non-empty, always safe to use verbatim as a URL path segment, a Redis
  key, or a Socket.io room name, with no percent-encoding required.

**`SocketController.onJoinRoom` slugifies the `room` field immediately**
and uses the slug - never the raw display name - for everything
downstream: `socket.join`, `RoomRepository.addUser`/`getUsersInRoom`,
`MessageHistoryRepository`, `ReadCursorRepository`, and the `roomData`
broadcast's `room` field. The join-required validation now also rejects
a whitespace-only room (`room.trim().length === 0`), closing a small gap
where `"   "` previously passed `!room`.

**No client changes.** `RoomPicker.vue`/`Chat.vue` still send/display
whatever free-text name the user typed or the URL already contains -
the slug is purely an internal, backend-side concern per the task's
acceptance criterion ("Backend should have a more easily readable room
name... than the display name"). This was also a deliberate way to stay
out of the other in-flight task touching this same area (Task 12,
private rooms with an access code) - `RoomPicker.vue` was left
untouched.

**Round-trip, defined precisely.** "Given a URL slug, the backend can
find the room" holds in the sense that matters here: the slug *is* the
storage key, so any lookup already keyed by slug (roster, history,
cursors) works by construction. What is *not* supported is reconstructing
the original display name purely from a slug (e.g. recovering "Café"
from `cafe-<hash>`) - the display name is never persisted anywhere
server-side; it only ever exists as whatever text the client currently
holds. Re-deriving a room's slug always requires the display name that
produced it, which the client already retains as long as it's the one
that typed/navigated to it.

## Consequences

- **Existing persisted room/message/cursor data is discarded, not
  migrated.** Every Redis roster key
  (`chatme:members`/`chatme:socket-index`), Scylla history partition,
  and Redis read-cursor entry keyed by today's raw room string becomes
  orphaned the moment this ships - a room called `"general"` yesterday
  is `slugifyRoomName('general')` today, a different key. No dual-read,
  no backfill, no key-translation shim was written. This is an explicit,
  scoped decision: the project has no real users yet (local-only,
  pre-production), so there is no data worth preserving across this
  change. **This will need a real migration (dual-read old/new keys, or
  a one-time backfill job) before this kind of key-layout change ships
  to an environment with data worth keeping.**
- **Clearing stale local state**: the Docker Compose stack
  (`docker-compose.yml`) declares no named volumes for `redis`,
  `postgres`, or `scylla1/2/3` - their data is already ephemeral to the
  container's lifetime, so `docker compose down` (see the README's
  "Running the full stack locally") is sufficient to drop every
  pre-slug key. Running against a Redis instance managed outside Compose
  (e.g. a local `pnpm dev` pointed at a long-lived Redis), run
  `redis-cli -u "$REDIS_URL" FLUSHDB` to the same effect.
- Two different users typing the exact same display name (mod
  case/whitespace) now land in the same room, deterministically, with
  no directory lookup - this is intended (`docs/TASK_TRACKER.md`'s
  example: typing "CS study group" should reliably mean the same room
  every time), but it does mean there is no way to have two distinct
  rooms that share a display name; disambiguating those, if ever needed,
  is future work (e.g. Task 12's access-code rooms already sidestep this
  by scoping identity to the code, not the name).
- `inspectRoomState.ts` and any other internal tooling now see slugs
  rather than raw display names in its `room` column - the readability
  win the acceptance criterion asked for, at the cost of an operator no
  longer seeing the exact text a user typed when inspecting Redis state.

## Alternatives considered

- **Persist a `slug -> displayName` directory** so a slug-only URL could
  recover the original display name for the UI title, and so two rooms
  could theoretically share a stripped-down prefix while staying
  distinguishable by more than a hash. Rejected for now: it requires a
  new store (with its own Redis/in-memory-fallback shape decision, same
  as `RoomRepository`/`MessageHistoryRepository`), and the client never
  actually needs it today - it already has the display name from
  whatever brought it to the room. Revisit if/when Task 12's room-
  creation flow needs a place to persist a chosen name anyway.
- **Random or creation-time hash** (e.g. a UUID suffix, or a counter)
  instead of a deterministic content hash: would guarantee that two
  rooms with the same display name never collide, but requires
  persisting the assigned slug somewhere the *next* person typing the
  same name could look it up - otherwise repeated joins to "General"
  would each mint a new, different room. Rejected for the same reason as
  the directory alternative above: no persistence layer exists yet, and
  the deterministic hash gets "same name -> same room" for free.
- **Client-side slug computation** (so the address bar could show the
  canonical slug immediately, e.g. via `router.replace`): would need the
  exact same hash algorithm duplicated into `apps/client` (no shared
  package exists between the two workspaces yet - see
  `pnpm-workspace.yaml`), risking the two implementations silently
  drifting apart. Rejected in favor of a single, server-side source of
  truth; introducing a shared package purely for this one function felt
  like more structural change than this task's scope justified.
- **Reject non-ASCII/emoji display names outright** instead of silently
  stripping them: simpler slug logic, but pushes a confusing validation
  error onto a user for something as harmless as an emoji in a room
  name. Stripping (with the hash preserving disambiguation) keeps the
  join flow permissive while still producing a clean internal key.
