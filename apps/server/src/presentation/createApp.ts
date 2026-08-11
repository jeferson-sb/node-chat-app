import http from 'node:http';
import express, { type ErrorRequestHandler } from 'express';
import morgan from 'morgan';
import { Pool } from 'pg';
import { Client as ScyllaClient } from 'cassandra-driver';
import { toNodeHandler } from 'better-auth/node';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Namespace } from 'socket.io';
import type { Adapter } from 'socket.io-adapter';

import { setupSocketServer } from './websocket.ts';
import config from '../config/index.ts';
import HTTPError from '../infra/errors/HTTPError.ts';
import { createAuth, type AuthDatabase } from '../infra/auth/createAuth.ts';
import { requireAuthenticatedSocket } from './socketAuth.ts';
import { createRedisClient } from '../infra/redis/createRedisClient.ts';
import { InMemoryRoomRepository } from '../infra/rooms/InMemoryRoomRepository.ts';
import { RedisRoomRepository } from '../infra/rooms/RedisRoomRepository.ts';
import type { RoomRepository } from '../infra/rooms/RoomRepository.ts';
import { InMemoryMessageHistoryRepository } from '../infra/history/InMemoryMessageHistoryRepository.ts';
import { ScyllaMessageHistoryRepository } from '../infra/history/ScyllaMessageHistoryRepository.ts';
import type { MessageHistoryRepository } from '../infra/history/MessageHistoryRepository.ts';
import { InMemoryMessageQueue } from '../infra/queue/InMemoryMessageQueue.ts';
import { RedisMessageQueue } from '../infra/queue/RedisMessageQueue.ts';
import { RedisConsumerStream } from '../infra/queue/RedisConsumerStream.ts';
import { MessagePersistenceConsumer } from '../infra/queue/MessagePersistenceConsumer.ts';
import { RedisMessagePersistenceRunner } from '../infra/queue/RedisMessagePersistenceRunner.ts';
import type { MessageQueue } from '../infra/queue/MessageQueue.ts';

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
   * Closes any Redis connections opened for this app (no-op if REDIS_URL
   * wasn't set), the auth database pool (no-op if authDatabase was
   * injected — its lifecycle then belongs to the caller), and the Scylla
   * client (no-op if SCYLLA_CONTACT_POINTS wasn't set).
   */
  close: () => Promise<void>;
};

export type CreateAppDeps = {
  /**
   * Injection seam for tests: pass a Kysely dialect (e.g. kysely-pglite-dialect)
   * to run against an in-process database instead of a real Postgres pool.
   * Defaults to a pg.Pool built from config.databaseUrl.
   */
  authDatabase?: AuthDatabase;
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

type AuthSetup = {
  database: AuthDatabase;
  close: () => Promise<void>;
};

/**
 * Accounts are mandatory (docs/adr/2026-08-09-authentication.md), so unlike
 * REDIS_URL there's no in-memory fallback here — a missing DATABASE_URL is a
 * misconfiguration and should fail loudly at startup rather than silently
 * running without auth. When a database is injected (tests), its lifecycle
 * belongs to the caller, so close() is a no-op.
 */
const setupAuthDatabase = (authDatabase?: AuthDatabase): AuthSetup => {
  if (authDatabase) {
    return { database: authDatabase, close: async () => {} };
  }

  if (!config.databaseUrl) {
    throw new Error('DATABASE_URL is required to start the server');
  }

  const pool = new Pool({ connectionString: config.databaseUrl });
  return { database: pool, close: () => pool.end() };
};

type MessageHistorySetup = {
  messageHistory: MessageHistoryRepository;
  close: () => Promise<void>;
};

/**
 * Picks the chat history store. Without SCYLLA_CONTACT_POINTS, falls
 * back to single-process in-memory history — same graceful-degrade
 * pattern as setupRooms/REDIS_URL (see
 * docs/adr/2026-08-11-chat-history-storage.md).
 */
const setupMessageHistory = (): MessageHistorySetup => {
  if (!config.scyllaContactPoints) {
    return {
      messageHistory: new InMemoryMessageHistoryRepository(),
      close: async () => {},
    };
  }

  const client = new ScyllaClient({
    contactPoints: config.scyllaContactPoints,
    localDataCenter: config.scyllaLocalDataCenter,
    keyspace: 'chatme',
  });

  return {
    messageHistory: new ScyllaMessageHistoryRepository(client),
    close: () => client.shutdown(),
  };
};

type MessageQueueSetup = {
  messageQueue: MessageQueue;
  close: () => Promise<void>;
};

/**
 * Picks the send-message persistence buffer. Without REDIS_URL, falls
 * back to writing directly and synchronously to messageHistory - same
 * graceful-degrade pattern as setupRooms/setupMessageHistory (a single
 * process has no cross-node write to buffer against). With REDIS_URL, a
 * consumer group runner starts in-process, sharing the group with every
 * other replica, so any of them can persist any pending entry (see
 * docs/adr/2026-08-11-message-queue-persistence.md).
 */
const setupMessageQueue = (
  messageHistory: MessageHistoryRepository,
): MessageQueueSetup => {
  if (!config.redisUrl) {
    return {
      messageQueue: new InMemoryMessageQueue(messageHistory),
      close: async () => {},
    };
  }

  const producerClient = createRedisClient(config.redisUrl);
  const consumerReadClient = createRedisClient(config.redisUrl);

  const consumer = new MessagePersistenceConsumer({
    messageHistory,
    stream: new RedisConsumerStream(producerClient),
  });
  const runner = new RedisMessagePersistenceRunner(
    consumerReadClient,
    consumer,
  );
  const started = runner.start().catch(console.error);

  return {
    messageQueue: new RedisMessageQueue(producerClient),
    close: async () => {
      await started;
      await runner.stop();
      producerClient.disconnect();
      consumerReadClient.disconnect();
    },
  };
};

/**
 * Wires up the Express app, HTTP server, and Socket.io server without
 * starting to listen. Extracted from the server entrypoint so integration
 * tests can bind to an ephemeral port instead of the configured one.
 */
export const createApp = ({ authDatabase }: CreateAppDeps = {}): App => {
  const app = express();
  const httpServer = http.createServer(app);
  const { rooms, adapter, close: closeRooms } = setupRooms();
  const { database, close: closeAuthDatabase } =
    setupAuthDatabase(authDatabase);
  const { messageHistory, close: closeMessageHistory } = setupMessageHistory();
  const { messageQueue, close: closeMessageQueue } =
    setupMessageQueue(messageHistory);
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

  const close = async (): Promise<void> => {
    await closeRooms();
    await closeAuthDatabase();
    await closeMessageHistory();
    await closeMessageQueue();
  };

  return { app, httpServer, controller, close };
};
