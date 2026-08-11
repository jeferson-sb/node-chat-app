import { describe, expect, it, vi } from 'vitest';
import type { Socket } from 'socket.io';
import type { createAuth } from '../infra/auth/createAuth.ts';
import { getSocketUser, requireAuthenticatedSocket } from './socketAuth.ts';

const createMockSocket = (): Socket =>
  ({
    request: { headers: { cookie: 'better-auth.session_token=abc' } },
    data: {},
  }) as unknown as Socket;

const createMockAuth = (
  getSession: ReturnType<typeof vi.fn>,
): ReturnType<typeof createAuth> =>
  ({ api: { getSession } }) as unknown as ReturnType<typeof createAuth>;

describe('requireAuthenticatedSocket', () => {
  it('attaches the session user and allows the connection through', async () => {
    const user = { id: 'user-1', name: 'alice' };
    const getSession = vi.fn().mockResolvedValue({ user, session: {} });
    const middleware = requireAuthenticatedSocket(createMockAuth(getSession));
    const socket = createMockSocket();
    const next = vi.fn();

    await middleware(socket, next);

    expect(next).toHaveBeenCalledWith();
    expect(getSocketUser(socket)).toEqual(user);
  });

  it('rejects the connection when there is no session', async () => {
    const getSession = vi.fn().mockResolvedValue(null);
    const middleware = requireAuthenticatedSocket(createMockAuth(getSession));
    const socket = createMockSocket();
    const next = vi.fn();

    await middleware(socket, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(socket.data.user).toBeUndefined();
  });
});
