import { Pool } from 'pg';
import config from '../../config/index.ts';
import { logger } from '../logging/createLogger.ts';
import type { PgLike } from './PostgresUserRoomsRepository.ts';

/**
 * Idempotent schema setup for the user_rooms table
 * (docs/adr/2026-08-17-room-switching.md). No Kysely dependency: unlike
 * Better Auth's own tables, this is a single small table with no need
 * for a query builder, so plain SQL via the app's existing `pg`
 * dependency is enough. Exported so tests can run it against an
 * in-process pglite instance (PostgresUserRoomsRepository.test.ts),
 * same precedent as createTestAuthDatabase.ts standing in for a real
 * Postgres connection.
 */
export const migrateUserRooms = async (db: PgLike): Promise<void> => {
  await db.query(`
    CREATE TABLE IF NOT EXISTS user_rooms (
      user_id text NOT NULL,
      room text NOT NULL,
      display_name text NOT NULL,
      first_joined_at bigint NOT NULL,
      last_joined_at bigint NOT NULL,
      PRIMARY KEY (user_id, room)
    )
  `);

  // Backfills a table created before first_joined_at existed
  // (docs/adr/2026-08-17-room-switching.md's stable-ordering follow-up):
  // last_joined_at is the closest approximation available for a row that
  // predates this column. A no-op against a table that already has it.
  await db.query(
    `ALTER TABLE user_rooms ADD COLUMN IF NOT EXISTS first_joined_at bigint`,
  );
  await db.query(
    `UPDATE user_rooms SET first_joined_at = last_joined_at WHERE first_joined_at IS NULL`,
  );
  await db.query(
    `ALTER TABLE user_rooms ALTER COLUMN first_joined_at SET NOT NULL`,
  );
};

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!config.databaseUrl) {
    throw new Error('DATABASE_URL is required to run this migration');
  }

  const pool = new Pool({ connectionString: config.databaseUrl });
  await migrateUserRooms(pool);
  logger.info('Postgres schema ready (table "user_rooms")');
  await pool.end();
}
