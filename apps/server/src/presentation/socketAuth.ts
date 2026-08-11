import type { Socket } from 'socket.io';
import { fromNodeHeaders } from 'better-auth/node';
import type { createAuth } from '../infra/auth/createAuth.ts';

export type AuthenticatedUser = {
  id: string;
  name: string;
};

/**
 * socket.io connection middleware verifying the session cookie carried by
 * the handshake request (socket.request is the raw Node IncomingMessage
 * for that request - see websocket.ts's cors credentials:true, which is
 * what gets the browser to actually send it). Rejects the connection
 * outright when there's no valid session, so SocketController never has
 * to trust a client-supplied username (see
 * docs/adr/2026-08-09-authentication.md).
 */
export const requireAuthenticatedSocket =
  (auth: ReturnType<typeof createAuth>) =>
  async (socket: Socket, next: (err?: Error) => void): Promise<void> => {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(socket.request.headers),
    });

    if (!session) {
      next(new Error('Unauthorized'));
      return;
    }

    (socket.data as { user: AuthenticatedUser }).user = session.user;
    next();
  };

export const getSocketUser = (socket: Socket): AuthenticatedUser =>
  (socket.data as { user: AuthenticatedUser }).user;
