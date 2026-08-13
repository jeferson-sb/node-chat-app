import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, type App } from './createApp.ts';
import { createTestAuthDatabase } from '../infra/auth/createTestAuthDatabase.ts';
import config from '../config/index.ts';

type AuthResponse = {
  token: string | null;
  user: { id: string; email: string; name: string };
};

/**
 * Integration test against Better Auth's real HTTP endpoints (mounted by
 * createApp.ts), same style as chatFlow.integration.test.ts: a real HTTP
 * server on an ephemeral port, no mocking of Better Auth itself. Runs
 * against an in-process pglite database (see docs/adr/2026-08-09-authentication.md
 * for why production uses real Postgres instead) via kysely-pglite-dialect,
 * migrated with Better Auth's programmatic getMigrations - its CLI can't
 * target an in-process instance since it runs as a separate process.
 */
describe('auth (integration)', () => {
  let app: App;
  let baseUrl: string;

  beforeAll(async () => {
    const authDatabase = await createTestAuthDatabase();
    app = createApp({ authDatabase });
    await new Promise<void>((resolve) => app.httpServer.listen(0, resolve));
    const { port } = app.httpServer.address() as AddressInfo;
    baseUrl = `http://localhost:${port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  const signUp = (body: Record<string, unknown>) =>
    fetch(`${baseUrl}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  const signIn = (body: Record<string, unknown>) =>
    fetch(`${baseUrl}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('creates an account for a new email', async () => {
    const response = await signUp({
      name: 'Alice',
      email: 'alice@example.com',
      password: 'correct-password',
    });
    const body = (await response.json()) as AuthResponse;

    expect(response.status).toBe(200);
    expect(body.user.email).toBe('alice@example.com');
    expect(body.token).toBeTypeOf('string');
  });

  it('rejects signing up with an email that already has an account', async () => {
    await signUp({
      name: 'Bob',
      email: 'bob@example.com',
      password: 'original-password',
    });

    const response = await signUp({
      name: 'Someone else',
      email: 'bob@example.com',
      password: 'a-different-password',
    });

    expect(response.status).toBe(422);

    const loginWithOriginalPassword = await signIn({
      email: 'bob@example.com',
      password: 'original-password',
    });
    expect(loginWithOriginalPassword.status).toBe(200);
  });

  it('logs in with the correct credentials', async () => {
    await signUp({
      name: 'Carol',
      email: 'carol@example.com',
      password: 'correct-password',
    });

    const response = await signIn({
      email: 'carol@example.com',
      password: 'correct-password',
    });
    const body = (await response.json()) as AuthResponse;

    expect(response.status).toBe(200);
    expect(body.user.email).toBe('carol@example.com');
    expect(body.token).toBeTypeOf('string');
  });

  it('rejects logging in with the wrong password', async () => {
    await signUp({
      name: 'Dave',
      email: 'dave@example.com',
      password: 'correct-password',
    });

    const response = await signIn({
      email: 'dave@example.com',
      password: 'wrong-password',
    });

    expect(response.status).toBe(401);
  });

  it('logs out and invalidates the session cookie', async () => {
    await signUp({
      name: 'Erin',
      email: 'erin@example.com',
      password: 'correct-password',
    });

    const signInResponse = await signIn({
      email: 'erin@example.com',
      password: 'correct-password',
    });
    const cookie = signInResponse.headers.get('set-cookie') ?? '';

    const signOutResponse = await fetch(`${baseUrl}/api/auth/sign-out`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    expect(signOutResponse.status).toBe(200);

    const sessionAfterSignOut = await fetch(`${baseUrl}/api/auth/get-session`, {
      headers: { Cookie: cookie },
    });
    const body = await sessionAfterSignOut.json();

    expect(body).toBeNull();
  });

  it('allows credentialed cross-origin requests from the configured client', async () => {
    const response = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: config.client,
      },
      body: JSON.stringify({ email: 'nobody@example.com', password: 'x' }),
    });

    expect(response.headers.get('access-control-allow-origin')).toBe(
      config.client,
    );
    expect(response.headers.get('access-control-allow-credentials')).toBe(
      'true',
    );
  });
});
