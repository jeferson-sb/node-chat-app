import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Socket } from 'socket.io';
import type { createAuth } from '../infra/auth/createAuth.ts';
import { getSocketUser, requireAuthenticatedSocket } from './socketAuth.ts';

const createMockSocket = (): Socket => {
  const listeners = new Map<string, () => void>();

  return {
    request: { headers: { cookie: 'better-auth.session_token=abc' } },
    data: {},
    once: vi.fn((event: string, listener: () => void) => {
      listeners.set(event, listener);
    }),
    disconnect: vi.fn((): void => {
      listeners.get('disconnect')?.();
    }),
  } as unknown as Socket;
};

const createMockAuth = (
  getSession: ReturnType<typeof vi.fn>,
): ReturnType<typeof createAuth> =>
  ({ api: { getSession } }) as unknown as ReturnType<typeof createAuth>;

describe('requireAuthenticatedSocket', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

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

  it('disconnects the socket once its session is no longer valid', async () => {
    const user = { id: 'user-1', name: 'alice' };
    const getSession = vi
      .fn()
      .mockResolvedValueOnce({ user, session: {} })
      .mockResolvedValueOnce(null);
    const middleware = requireAuthenticatedSocket(createMockAuth(getSession), {
      sessionCheckIntervalMs: 1000,
    });
    const socket = createMockSocket();
    const next = vi.fn();

    await middleware(socket, next);
    await vi.advanceTimersByTimeAsync(1000);

    expect(getSession).toHaveBeenCalledTimes(2);
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  it('keeps the socket connected while its session stays valid', async () => {
    const user = { id: 'user-1', name: 'alice' };
    const getSession = vi.fn().mockResolvedValue({ user, session: {} });
    const middleware = requireAuthenticatedSocket(createMockAuth(getSession), {
      sessionCheckIntervalMs: 1000,
    });
    const socket = createMockSocket();
    const next = vi.fn();

    await middleware(socket, next);
    await vi.advanceTimersByTimeAsync(3000);

    expect(socket.disconnect).not.toHaveBeenCalled();
  });

  it('stops re-checking the session after the socket disconnects', async () => {
    const user = { id: 'user-1', name: 'alice' };
    const getSession = vi.fn().mockResolvedValue({ user, session: {} });
    const middleware = requireAuthenticatedSocket(createMockAuth(getSession), {
      sessionCheckIntervalMs: 1000,
    });
    const socket = createMockSocket();
    const next = vi.fn();

    await middleware(socket, next);
    socket.disconnect(true);
    getSession.mockClear();
    await vi.advanceTimersByTimeAsync(3000);

    expect(getSession).not.toHaveBeenCalled();
  });
});
