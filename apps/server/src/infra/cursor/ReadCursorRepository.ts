/**
 * Tracks, per (room, username), the timestamp up to which a user has
 * already seen messages in a room - either delivered via the missed-
 * message backfill on join, or received live via broadcast while
 * connected. This is what lets a reconnecting user be handed only the
 * messages sent while they were offline (docs/TASK_TRACKER.md Task 10,
 * docs/adr/2026-08-14-offline-delivery.md), instead of always replaying
 * a fixed window of recent history regardless of whether they'd already
 * seen most of it.
 *
 * Deliberately Redis-only: without REDIS_URL configured, offline
 * delivery is disabled outright (NullReadCursorRepository) rather than
 * gaining a single-process fallback - a cursor that doesn't survive a
 * restart or isn't shared across nodes would misbehave silently, rather
 * than the feature simply being unavailable.
 */
export type ReadCursorRepository = {
  /** Newest message timestamp (ms) this user has already seen in this room, or undefined if never recorded. */
  getLastSeenAt(room: string, username: string): Promise<number | undefined>;
  /** Records that this user has seen everything in this room up to (and including) seenAt. */
  markSeen(room: string, username: string, seenAt: number): Promise<void>;
};
