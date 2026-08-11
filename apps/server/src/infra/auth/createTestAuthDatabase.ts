import { PGlite } from '@electric-sql/pglite';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { getMigrations } from 'better-auth/db/migration';
import { buildAuthOptions, type AuthDatabase } from './createAuth.ts';

/**
 * Test-only auth database: an in-process, pglite-backed Kysely dialect
 * instead of a real Postgres connection (see docs/adr/2026-08-09-authentication.md
 * for why production uses Postgres regardless). Better Auth's CLI can't
 * migrate this since it runs as a separate process and wouldn't share this
 * in-memory instance, so migrations run programmatically via getMigrations.
 */
export const createTestAuthDatabase = async (): Promise<AuthDatabase> => {
  const dialect = new PGliteDialect(new PGlite());
  const { runMigrations } = await getMigrations(buildAuthOptions(dialect));
  await runMigrations();
  return dialect;
};
