import { Pool } from 'pg';
import { createAuth } from './infra/auth/createAuth.ts';
import config from './config/index.ts';

/**
 * CLI-only entry point: `npx @better-auth/cli migrate` looks for a file
 * named auth.ts exporting an `auth` instance to introspect its schema. The
 * runtime app doesn't use this - createApp.ts builds its own instance via
 * createAuth(), injecting a test database in tests (see createAuth.ts).
 */
if (!config.databaseUrl) {
  throw new Error('DATABASE_URL is required to run Better Auth migrations');
}

export const auth = createAuth(
  new Pool({ connectionString: config.databaseUrl }),
  [config.client],
);
