# The `history` event carries a snapshot, not a delta

- Status: Accepted
- Date: 2026-08-15
- Amends: [Deliver missed messages on reconnect via a per-(room, username) read cursor](2026-08-14-offline-delivery.md)

## Context

`docs/adr/2026-08-14-offline-delivery.md` changed `SocketController.onJoinRoom`
to emit `eventTypes.history` as *only what the user missed* since their
read cursor, where it had previously always emitted the room's recent
window. It explicitly avoided a matching client change ("avoids a
client-side change for this task").

The client, though, has never treated `history` as a delta.
`apps/client/src/components/Chat.vue` assigns it:

```js
socket.on('history', (history) => {
  messages.value = history
})
```

It keeps no local copy of the conversation across a reload, so the
payload *is* the transcript. Combined with `onDisconnect` advancing the
cursor to the moment the user left, every ordinary reconnect - a page
refresh, a dropped wifi connection - produced an empty `getMessagesSince`
result, which the client then assigned over the entire message list. The
room rendered empty.

Reproduced against the docker-compose stack: a user reconnecting to a
room they had just posted in received `0` messages, while a *different*
user joining that same room at that same moment received all of them.
The messages were in ScyllaDB the whole time; they simply stopped being
sent to the one person who wrote them.

A second defect surfaced in the same area. `getMessagesSince` filters
`createdAt > sinceAt`, and `onDisconnect` wrote `Date.now()`. Millisecond
timestamps make ties ordinary, not rare: a message broadcast in the same
millisecond as a disconnect was silently undeliverable to that user
forever. This was already visible as a ~75% flake in the
`delivers messages sent while a user was offline` integration test,
misread as CPU-load noise.

## Decision

**`onJoinRoom` always fetches the recent window, and merges anything
missed since the cursor into it.** The two are requested concurrently and
combined by `mergeHistory`
(`apps/server/src/presentation/controllers/mergeHistory.ts`), which
deduplicates by message id, orders newest-first, and caps at
`HISTORY_LIMIT`.

The merge is not redundant even though `missed` is usually a subset of
`recent`: `ScyllaMessageHistoryRepository.getRecentMessages` only scans a
fixed `BUCKET_LOOKBACK` of weekly buckets, while `getMessagesSince` walks
back as far as the cursor requires. In a room quiet for longer than that
lookback, the cursor-bounded walk is the only one that finds anything.
Deduplicating by id is what makes calling both unconditionally safe.

**The cursor only ever moves forward.** Because the recent window
deliberately reaches back past the cursor, the newest message delivered
on join can be one the user has already seen; advancing the cursor to it
unconditionally would rewind read progress and report a prior session as
unread. `onJoinRoom` now advances only when the newest delivered message
is strictly newer than the existing cursor.

**`onDisconnect` writes `Date.now() - 1`.** `ReadCursorRepository`'s
contract is "seen everything up to *and including* `seenAt`", so the
strict `>` comparison is correct and stays. What was wrong is the claim:
a departing user has seen everything up to the instant they left, not
through the end of that millisecond. Stepping the cursor back one
millisecond makes the claim true and the tie deliverable.

## Consequences

- **A reconnecting user re-receives messages they already saw**, where
  the previous design sent only the delta. This is the point: the event
  is a snapshot, and the client replaces its transcript with it. The cost
  is bandwidth on join, bounded by `HISTORY_LIMIT` exactly as it was
  before Task 10.
- **The read cursor no longer determines what is displayed** - only how
  far back the fetch reaches. It remains the right primitive for an
  unread divider or a "N new messages" marker, which can now be built
  without changing what the wire carries.
- **Two history reads per join instead of one** (issued concurrently, so
  one round trip's latency rather than two). Only the second is skipped
  for a first-ever join, where there is no cursor.
- The previously flaky offline-delivery integration test is now
  deterministic, and the millisecond tie has direct coverage in
  `SocketController.test.ts` using a frozen clock.
- The known async-persistence race from the amended ADR still stands: a
  message still sitting in the Redis stream when someone joins is not yet
  queryable from either fetch.

## Alternatives considered

- **Revert to always `getRecentMessages`**, dropping the cursor entirely:
  the smallest fix, and it resolves the reported bug. Rejected because it
  discards the one thing the cursor buys that a fixed window cannot - a
  user offline for longer than the recent window's reach still gets what
  they missed - for no gain beyond deleting a few lines. The cursor also
  remains the foundation for unread indicators.
- **Make the client merge instead of assign** (`messages.value.push(...)`
  over a delta): rejected because it cannot work on its own. A browser
  that has just reloaded has an empty message list, so merging a delta
  into it still renders an empty room. Fixing it client-side would mean
  persisting the transcript locally (`localStorage`/IndexedDB) and
  reconciling it against the server, which is a substantially larger
  design - and one that still needs a server-side snapshot to reconcile
  against on a new device.
- **Send both, as separate `history` and `missed` events**, letting the
  client render a divider between them: this is the natural shape *if*
  the unread marker is wanted, but it needs the client work this bug
  fixes without, and the payloads overlap so heavily that the client
  would have to deduplicate them anyway. Deferred rather than rejected -
  the cursor is still maintained, so it stays available.
- **Widen the comparison to `createdAt >= sinceAt`** instead of stepping
  the disconnect cursor back: also closes the tie, but by contradicting
  `ReadCursorRepository`'s documented "up to and including" contract, and
  it would redeliver the boundary message on every join for every caller,
  not just the disconnect path that had the wrong timestamp.
