import { betterAuth, type BetterAuthOptions } from 'better-auth';
import type { Dialect } from 'kysely';
import type { Pool } from 'pg';

/**
 * Better Auth accepts a much wider `database` union (Mysql/Sqlite/D1/ORM
 * adapters, etc. - see BetterAuthOptions['database']); this app only ever
 * passes a Postgres pool (production) or a Kysely dialect (tests, via
 * kysely-pglite-dialect), so the narrower type is what's actually true here.
 */
export type AuthDatabase = Pool | Dialect;

export const buildAuthOptions = (
  database: AuthDatabase,
  trustedOrigins: string[] = [],
): BetterAuthOptions => ({
  database,
  emailAndPassword: { enabled: true },
  trustedOrigins,
});

export const createAuth = (
  database: AuthDatabase,
  trustedOrigins: string[] = [],
) => betterAuth(buildAuthOptions(database, trustedOrigins));
