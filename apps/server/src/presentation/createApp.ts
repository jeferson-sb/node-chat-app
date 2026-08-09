import http from 'node:http';
import express, { type ErrorRequestHandler } from 'express';
import morgan from 'morgan';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Namespace } from 'socket.io';
import type { Adapter } from 'socket.io-adapter';

import { setupSocketServer } from './websocket.ts';
import config from '../config/index.ts';
import HTTPError from '../infra/errors/HTTPError.ts';
import { createRedisClient } from '../infra/redis/createRedisClient.ts';
import { InMemoryRoomRepository } from '../infra/rooms/InMemoryRoomRepository.ts';
import { RedisRoomRepository } from '../infra/rooms/RedisRoomRepository.ts';
import type { RoomRepository } from '../infra/rooms/RoomRepository.ts';

// TODO: Extract to use case
import SocketController, {
  type JoinRoomPayload,
  type SendMessagePayload,
} from './controllers/SocketController.ts';

export type App = {
  app: express.Express;
  httpServer: http.Server;
  controller: SocketController;
  /** Closes any Redis connections opened for this app. No-op if REDIS_URL wasn't set. */
  close: () => Promise<void>;
};

type RoomsSetup = {
  rooms: RoomRepository;
  adapter?: (nsp: Namespace) => Adapter;
  close: () => Promise<void>;
};

/**
 * Picks the room roster store and, when REDIS_URL is configured, the
 * socket.io adapter needed to broadcast across server nodes. Without
 * REDIS_URL, both fall back to single-process, in-memory behavior — the
 * app still works standalone (e.g. local dev, a single Fly.io machine),
 * it just can't be scaled horizontally behind a load balancer. See
 * docker-compose.yml for a multi-node setup using both.
 */
const setupRooms = (): RoomsSetup => {
  if (!config.redisUrl) {
    return { rooms: new InMemoryRoomRepository(), close: async () => {} };
  }

  const roomsClient = createRedisClient(config.redisUrl);
  const pubClient = createRedisClient(config.redisUrl);
  const subClient = pubClient.duplicate();

  return {
    rooms: new RedisRoomRepository(roomsClient),
    adapter: createAdapter(pubClient, subClient),
    close: async () => {
      roomsClient.disconnect();
      pubClient.disconnect();
      subClient.disconnect();
    },
  };
};

/**
 * Wires up the Express app, HTTP server, and Socket.io server without
 * starting to listen. Extracted from the server entrypoint so integration
 * tests can bind to an ephemeral port instead of the configured one.
 */
export const createApp = (): App => {
  const app = express();
  const httpServer = http.createServer(app);
  const { rooms, adapter, close } = setupRooms();
  const socketServer = setupSocketServer(httpServer, { adapter });
  const controller = new SocketController({ socketServer, rooms });

  // Add Access Control Allow Origin headers
  app.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', config.client);
    res.header(
      'Access-Control-Allow-Headers',
      'Origin, X-Requested-With, Content-Type, Accept',
    );
    next();
  });

  socketServer.on('connection', (socket) => {
    console.log(`[socket]: new socket connected: ${socket.id}`);

    // Listen to socket events. Handlers are async (they now call the
    // Redis-backed RoomRepository when REDIS_URL is set), so failures are
    // caught here instead of becoming an unhandled rejection that would
    // crash the process on a transient Redis error.
    socket.on('join', (data: JoinRoomPayload) => {
      controller.onJoinRoom(socket, data).catch(console.error);
    });
    socket.on('error', () => controller.onConnectionError(socket));
    socket.on('sendMessage', (data: SendMessagePayload) => {
      controller.onSendMessage(socket, data).catch(console.error);
    });
    socket.on('disconnect', () => {
      controller.onDisconnect(socket).catch(console.error);
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

  return { app, httpServer, controller, close };
};
