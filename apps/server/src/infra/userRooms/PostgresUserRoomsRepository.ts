import type {
  JoinedRoom,
  RecordJoinParams,
  UserRoomsRepository,
} from './UserRoomsRepository.ts';

type UserRoomRow = {
  room: string;
  display_name: string;
  last_joined_at: number;
};

/**
 * The subset of `pg.Pool`'s query API this repository needs - also
 * satisfied by `@electric-sql/pglite`'s `PGlite`, which is what
 * PostgresUserRoomsRepository.test.ts runs against instead of a real
 * Postgres connection (see createTestAuthDatabase.ts for the same
 * pglite-stands-in-for-Postgres precedent).
 */
export type PgLike = {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
};

export class PostgresUserRoomsRepository implements UserRoomsRepository {
  private readonly db: PgLike;

  constructor(db: PgLike) {
    this.db = db;
  }

  async recordJoin({
    userId,
    room,
    displayName,
    joinedAt,
  }: RecordJoinParams): Promise<void> {
    // first_joined_at is set only on the initial insert (excluded from
    // the conflict update) so a room's position in listJoinedRooms stays
    // stable across repeat joins/switches - only last_joined_at moves.
    await this.db.query(
      `INSERT INTO user_rooms (user_id, room, display_name, first_joined_at, last_joined_at)
       VALUES ($1, $2, $3, $4, $4)
       ON CONFLICT (user_id, room)
       DO UPDATE SET display_name = excluded.display_name, last_joined_at = excluded.last_joined_at`,
      [userId, room, displayName, joinedAt],
    );
  }

  async listJoinedRooms(userId: string): Promise<JoinedRoom[]> {
    const { rows } = await this.db.query<UserRoomRow>(
      `SELECT room, display_name, last_joined_at
       FROM user_rooms
       WHERE user_id = $1
       ORDER BY first_joined_at ASC`,
      [userId],
    );

    return rows.map((row) => ({
      room: row.room,
      displayName: row.display_name,
      lastJoinedAt: Number(row.last_joined_at),
    }));
  }
}
