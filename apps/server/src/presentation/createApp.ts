import http from 'node:http';
import express, { type ErrorRequestHandler } from 'express';
import morgan from 'morgan';
import { toNodeHandler } from 'better-auth/node';

import { setupSocketServer } from './websocket.ts';
import config from '../config/index.ts';
import HTTPError from '../infra/errors/HTTPError.ts';
import { createAuth } from '../infra/auth/createAuth.ts';
import { requireAuthenticatedSocket } from './socketAuth.ts';
import { bootstrap, type BootstrapDeps } from '../bootstrap.ts';
import { logger } from '../infra/logging/createLogger.ts';

// TODO: Extract to use case
import SocketController, {
  type JoinRoomPayload,
  type SendMessagePayload,
} from './controllers/SocketController.ts';

export type App = {
  app: express.Express;
  httpServer: http.Server;
  controller: SocketController;
  /**
   * Closes every open Socket.io connection (each client is force-
   * disconnected, not given a grace period to finish up - acceptable for
   * a server shutdown), the underlying HTTP server, and whatever real
   * backing-service connections bootstrap.ts opened for this app.
   */
  close: () => Promise<void>;
};

export type CreateAppDeps = BootstrapDeps;

/**
 * Wires up the Express app, HTTP server, and Socket.io server without
 * starting to listen. Extracted from the server entrypoint so integration
 * tests can bind to an ephemeral port instead of the configured one.
 * Service instantiation itself lives in bootstrap.ts - this only wires
 * already-resolved services into Express/Socket.io (docs/TASK_TRACKER.md
 * Task 6).
 */
export const createApp = (deps: CreateAppDeps = {}): App => {
  const app = express();
  const httpServer = http.createServer(app);
  const { rooms, adapter, database, messageHistory, messageQueue, close } =
    bootstrap(deps);
  const socketServer = setupSocketServer(httpServer, { adapter });
  const controller = new SocketController({
    socketServer,
    rooms,
    messageHistory,
    messageQueue,
  });
  const auth = createAuth(database, [config.client]);
  socketServer.use(requireAuthenticatedSocket(auth));

  // Must run before the auth mount below: Better Auth's handler responds
  // directly (it never calls next()), so CORS headers added afterwards
  // would never reach the client - the browser would then reject the
  // response, since Better Auth's cross-origin sign-in/sign-up requests
  // carry credentials (the session cookie).
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', config.client);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.header(
      'Access-Control-Allow-Headers',
      'Origin, X-Requested-With, Content-Type, Accept',
    );
    res.header(
      'Access-Control-Allow-Methods',
      'GET, POST, PUT, DELETE, OPTIONS',
    );

    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }

    next();
  });

  app.all('/api/auth/*splat', toNodeHandler(auth));

  socketServer.on('connection', (socket) => {
    logger.info({ socketId: socket.id }, 'new socket connected');

    // Listen to socket events. Handlers are async (they now call the
    // Redis-backed RoomRepository when REDIS_URL is set), so failures are
    // caught here instead of becoming an unhandled rejection that would
    // crash the process on a transient Redis error.
    socket.on('join', (data: JoinRoomPayload) => {
      controller.onJoinRoom(socket, data).catch((error: unknown) => {
        logger.error({ err: error, socketId: socket.id }, 'onJoinRoom failed');
      });
    });
    socket.on('error', () => controller.onConnectionError(socket));
    socket.on('sendMessage', (data: SendMessagePayload) => {
      controller.onSendMessage(socket, data).catch((error: unknown) => {
        logger.error(
          { err: error, socketId: socket.id },
          'onSendMessage failed',
        );
      });
    });
    socket.on('disconnect', () => {
      controller.onDisconnect(socket).catch((error: unknown) => {
        logger.error(
          { err: error, socketId: socket.id },
          'onDisconnect failed',
        );
      });
    });
  });

  if (config.mode === 'development') {
    app.use(morgan('dev'));
  }

  const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof HTTPError) {
      res.status(err.statusCode).json({
        status: 'error',
        message: err.message,
      });
      return;
    }

    res.status(500).json({ message: 'Internal Server Error', status: 'error' });
  };

  app.use(errorHandler);

  const closeAll = async (): Promise<void> => {
    // socketServer.close() already closes the underlying httpServer for
    // us (and every open socket connection, and the Redis adapter if
    // any) - see socket.io's Server.close(). Awaiting bootstrap's close()
    // after it, rather than concurrently, so backing services (Redis,
    // Postgres, Scylla) aren't torn down while a request/socket handler
    // might still be mid-flight against them.
    await socketServer.close();
    await close();
  };

  return { app, httpServer, controller, close: closeAll };
};
