import type { Socket } from 'socket.io';
import { DomainError } from '../domain/errors/DomainError.ts';
import { eventTypes } from '../utils/eventTypes.ts';
import { logger } from '../infra/logging/createLogger.ts';

export type SocketErrorPayload = {
  code: string;
  message: string;
};

const GENERIC_ERROR_PAYLOAD: SocketErrorPayload = {
  code: 'INTERNAL_ERROR',
  message: 'Something went wrong, please try again.',
};

/**
 * Socket.io counterpart to createApp.ts's Express error-handling
 * middleware: a `DomainError` (ValidationError, RoomNotFoundError, ...)
 * maps to a client-facing `error` event carrying its `code`/`message`
 * (mirroring how HTTPError maps to a JSON body there), while anything
 * else is logged as unexpected and the client only gets a generic
 * message - never a raw internal error string.
 *
 * Wraps each socket event handler at its `socket.on(...)` registration
 * site (createApp.ts), replacing the previous `.catch(console.error)`
 * that silently swallowed failures instead of telling the client
 * anything went wrong.
 */
export const handleSocketEvent = (
  socket: Socket,
  handler: () => Promise<void>,
): Promise<void> =>
  handler().catch((error: unknown) => {
    if (error instanceof DomainError) {
      logger.warn(
        { err: error, socketId: socket.id, code: error.code },
        'socket handler rejected by a domain error',
      );
      socket.emit(eventTypes.error, {
        code: error.code,
        message: error.message,
      } satisfies SocketErrorPayload);
      return;
    }

    logger.error(
      { err: error, socketId: socket.id },
      'unhandled error in socket handler',
    );
    socket.emit(eventTypes.error, GENERIC_ERROR_PAYLOAD);
  });
