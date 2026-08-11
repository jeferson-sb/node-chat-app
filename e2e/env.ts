// Shared between playwright.config.ts (server webServer env) and
// globalSetup.ts (migrating that same database before tests run) so they
// can't drift apart.
export const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgres://postgres:postgres@localhost:5432/chatme';

export const BETTER_AUTH_SECRET =
  process.env.BETTER_AUTH_SECRET ?? 'e2e-test-secret-do-not-use-in-production';
