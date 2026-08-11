import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { DATABASE_URL, BETTER_AUTH_SECRET } from './env.ts';

const execAsync = promisify(exec);

/**
 * Applies Better Auth's schema to DATABASE_URL before any test/webServer
 * queries it. Postgres has no in-memory fallback (see
 * docs/adr/2026-08-09-authentication.md), and the CLI can't target the
 * in-process pglite instance the vitest suite uses (see
 * apps/server/src/infra/auth/createTestAuthDatabase.ts) - e2e needs a real,
 * already-migrated Postgres reachable at DATABASE_URL (e.g.
 * `docker compose up -d postgres`).
 */
export default async function globalSetup(): Promise<void> {
  await execAsync('pnpm --filter @chatme/server run db:migrate', {
    env: { ...process.env, DATABASE_URL, BETTER_AUTH_SECRET },
  });
}
