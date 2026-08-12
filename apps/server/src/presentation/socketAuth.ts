import type { Socket } from 'socket.io';
import { fromNodeHeaders } from 'better-auth/node';
import type { createAuth } from '../infra/auth/createAuth.ts';

export type AuthenticatedUser = {
  id: string;
  name: string;
};

export type RequireAuthenticatedSocketOptions = {
  /**
   * How often to re-verify the session against the database after the
   * initial handshake check. The handshake cookie only proves the session
   * was valid *at connect time* - if the user logs out from another tab
   * (or their session is otherwise revoked) mid-connection, nothing
   * re-checks that same still-open socket without this. Defaults to 30s:
   * frequent enough that a revoked session doesn't linger long, without
   * hammering the auth database per connected socket.
   */
  sessionCheckIntervalMs?: number;
};

const DEFAULT_SESSION_CHECK_INTERVAL_MS = 30_000;

/**
 * socket.io connection middleware verifying the session cookie carried by
 * the handshake request (socket.request is the raw Node IncomingMessage
 * for that request - see websocket.ts's cors credentials:true, which is
 * what gets the browser to actually send it). Rejects the connection
 * outright when there's no valid session, so SocketController never has
 * to trust a client-supplied username (see
 * docs/adr/2026-08-09-authentication.md).
 *
 * Also re-verifies that same session periodically for as long as the
 * socket stays open, and disconnects it the moment the session is no
 * longer valid - closing the gap where logging out in one tab left a
 * different tab's already-open socket connected indefinitely (flagged as
 * a known gap in Task 7, docs/TASK_TRACKER.md).
 */
export const requireAuthenticatedSocket =
  (
    auth: ReturnType<typeof createAuth>,
    {
      sessionCheckIntervalMs = DEFAULT_SESSION_CHECK_INTERVAL_MS,
    }: RequireAuthenticatedSocketOptions = {},
  ) =>
  async (socket: Socket, next: (err?: Error) => void): Promise<void> => {
    const headers = fromNodeHeaders(socket.request.headers);
    const session = await auth.api.getSession({ headers });

    if (!session) {
      next(new Error('Unauthorized'));
      return;
    }

    (socket.data as { user: AuthenticatedUser }).user = session.user;

    const interval = setInterval(() => {
      auth.api
        .getSession({ headers })
        .then((currentSession) => {
          if (!currentSession) {
            socket.disconnect(true);
          }
        })
        .catch(console.error);
    }, sessionCheckIntervalMs);

    socket.once('disconnect', () => clearInterval(interval));

    next();
  };

export const getSocketUser = (socket: Socket): AuthenticatedUser =>
  (socket.data as { user: AuthenticatedUser }).user;
