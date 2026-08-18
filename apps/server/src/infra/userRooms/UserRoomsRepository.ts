/** One room a user has joined at least once, for the room-switch list (Task 14). */
export type JoinedRoom = {
  room: string;
  displayName: string;
  lastJoinedAt: number;
};

export type RecordJoinParams = {
  userId: string;
  room: string;
  displayName: string;
  joinedAt: number;
};

/**
 * Per-account history of joined rooms, backing the room-switch list
 * (docs/adr/2026-08-17-room-switching.md) - distinct from RoomRepository,
 * which tracks only who's *currently* online in a room, not history.
 * Postgres-backed (see PostgresUserRoomsRepository) rather than
 * Redis/in-memory: this must survive a restart and follow the user
 * across devices/browsers, same durability bar as the account itself.
 */
export type UserRoomsRepository = {
  /** Upserts (userId, room), refreshing its display name and last-joined time. */
  recordJoin(params: RecordJoinParams): Promise<void>;
  /** Most-recently-joined first. */
  listJoinedRooms(userId: string): Promise<JoinedRoom[]>;
};
