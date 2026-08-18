import { Pool } from 'pg';
import { Client as ScyllaClient } from 'cassandra-driver';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Namespace } from 'socket.io';
import type { Adapter } from 'socket.io-adapter';

import config from './config/index.ts';
import type { AuthDatabase } from './infra/auth/createAuth.ts';
import { createRedisClient } from './infra/redis/createRedisClient.ts';
import { InMemoryRoomRepository } from './infra/rooms/InMemoryRoomRepository.ts';
import { RedisRoomRepository } from './infra/rooms/RedisRoomRepository.ts';
import type { RoomRepository } from './infra/rooms/RoomRepository.ts';
import { InMemoryMessageHistoryRepository } from './infra/history/InMemoryMessageHistoryRepository.ts';
import { ScyllaMessageHistoryRepository } from './infra/history/ScyllaMessageHistoryRepository.ts';
import type { MessageHistoryRepository } from './infra/history/MessageHistoryRepository.ts';
import { InMemoryMessageQueue } from './infra/queue/InMemoryMessageQueue.ts';
import { RedisMessageQueue } from './infra/queue/RedisMessageQueue.ts';
import { RedisConsumerStream } from './infra/queue/RedisConsumerStream.ts';
import { MessagePersistenceConsumer } from './infra/queue/MessagePersistenceConsumer.ts';
import { RedisMessagePersistenceRunner } from './infra/queue/RedisMessagePersistenceRunner.ts';
import type { MessageQueue } from './infra/queue/MessageQueue.ts';
import { NullReadCursorRepository } from './infra/cursor/NullReadCursorRepository.ts';
import { RedisReadCursorRepository } from './infra/cursor/RedisReadCursorRepository.ts';
import type { ReadCursorRepository } from './infra/cursor/ReadCursorRepository.ts';
import { PostgresUserRoomsRepository } from './infra/userRooms/PostgresUserRoomsRepository.ts';
import type { UserRoomsRepository } from './infra/userRooms/UserRoomsRepository.ts';
import { logger } from './infra/logging/createLogger.ts';

/**
 * Injection seam for the whole app: `createApp.ts` passes this straight
 * through from its own deps parameter, and tests override whichever
 * services they need a fake/in-process version of (see
 * createTestAuthDatabase.ts for `authDatabase`, InMemoryRoomRepository/
 * InMemoryMessageHistoryRepository/InMemoryMessageQueue for the rest).
 * Anything not overridden falls back to the real, config/env-driven
 * service - same graceful-degrade resolution each service already had
 * inline in createApp.ts before this was extracted.
 */
export type BootstrapDeps = {
  authDatabase?: AuthDatabase;
  rooms?: RoomRepository;
  messageHistory?: MessageHistoryRepository;
  messageQueue?: MessageQueue;
  readCursors?: ReadCursorRepository;
  userRooms?: UserRoomsRepository;
};

export type Services = {
  rooms: RoomRepository;
  database: AuthDatabase;
  messageHistory: MessageHistoryRepository;
  messageQueue: MessageQueue;
  readCursors: ReadCursorRepository;
  userRooms: UserRoomsRepository;
  /**
   * Socket.io adapter for cross-node broadcast, only set when the real
   * Redis-backed rooms service is in use (REDIS_URL configured, no
   * `rooms` override) - see resolveRooms.
   */
  adapter?: (nsp: Namespace) => Adapter;
  /**
   * Closes whatever real connections this bootstrap opened (Redis
   * clients, the Postgres pool, the Scylla client, the message
   * persistence runner). A no-op for any service that was overridden via
   * BootstrapDeps, since its lifecycle then belongs to the caller.
   */
  close: () => Promise<void>;
};

type Resolved<T> = {
  value: T;
  adapter?: (nsp: Namespace) => Adapter;
  close: () => Promise<void>;
};

const noClose = async (): Promise<void> => {};

/**
 * Picks the room roster store and, when REDIS_URL is configured, the
 * socket.io adapter needed to broadcast across server nodes. Without
 * REDIS_URL, both fall back to single-process, in-memory behavior — the
 * app still works standalone (e.g. local dev, a single Fly.io machine),
 * it just can't be scaled horizontally behind a load balancer. See
 * docker-compose.yml for a multi-node setup using both.
 */
const resolveRooms = (override?: RoomRepository): Resolved<RoomRepository> => {
  if (override) {
    return { value: override, close: noClose };
  }

  if (!config.redisUrl) {
    return { value: new InMemoryRoomRepository(), close: noClose };
  }

  const roomsClient = createRedisClient(config.redisUrl);
  const pubClient = createRedisClient(config.redisUrl);
  const subClient = pubClient.duplicate();

  return {
    value: new RedisRoomRepository(roomsClient),
    adapter: createAdapter(pubClient, subClient),
    close: async () => {
      roomsClient.disconnect();
      pubClient.disconnect();
      subClient.disconnect();
    },
  };
};

/**
 * Accounts are mandatory (docs/adr/2026-08-09-authentication.md), so unlike
 * REDIS_URL there's no in-memory fallback here — a missing DATABASE_URL is a
 * misconfiguration and should fail loudly at startup rather than silently
 * running without auth. When a database is injected (tests), its lifecycle
 * belongs to the caller, so close() is a no-op.
 */
const resolveAuthDatabase = (
  override?: AuthDatabase,
): Resolved<AuthDatabase> => {
  if (override) {
    return { value: override, close: noClose };
  }

  if (!config.databaseUrl) {
    throw new Error('DATABASE_URL is required to start the server');
  }

  const pool = new Pool({ connectionString: config.databaseUrl });
  return { value: pool, close: () => pool.end() };
};

/**
 * Picks the chat history store. Without SCYLLA_CONTACT_POINTS, falls
 * back to single-process in-memory history — same graceful-degrade
 * pattern as resolveRooms/REDIS_URL (see
 * docs/adr/2026-08-11-chat-history-storage.md).
 */
const resolveMessageHistory = (
  override?: MessageHistoryRepository,
): Resolved<MessageHistoryRepository> => {
  if (override) {
    return { value: override, close: noClose };
  }

  if (!config.scyllaContactPoints) {
    return { value: new InMemoryMessageHistoryRepository(), close: noClose };
  }

  const client = new ScyllaClient({
    contactPoints: config.scyllaContactPoints,
    localDataCenter: config.scyllaLocalDataCenter,
    keyspace: 'chatme',
  });

  return {
    value: new ScyllaMessageHistoryRepository(client),
    close: () => client.shutdown(),
  };
};

/**
 * Picks the send-message persistence buffer. Without REDIS_URL, falls
 * back to writing directly and synchronously to messageHistory - same
 * graceful-degrade pattern as resolveRooms/resolveMessageHistory (a
 * single process has no cross-node write to buffer against). With
 * REDIS_URL, a consumer group runner starts in-process, sharing the
 * group with every other replica, so any of them can persist any
 * pending entry (see docs/adr/2026-08-11-message-queue-persistence.md).
 */
const resolveMessageQueue = (
  messageHistory: MessageHistoryRepository,
  override?: MessageQueue,
): Resolved<MessageQueue> => {
  if (override) {
    return { value: override, close: noClose };
  }

  if (!config.redisUrl) {
    return { value: new InMemoryMessageQueue(messageHistory), close: noClose };
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
  const started = runner.start().catch((error: unknown) => {
    logger.error({ err: error }, 'message persistence runner failed to start');
  });

  return {
    value: new RedisMessageQueue(producerClient),
    close: async () => {
      await started;
      await runner.stop();
      producerClient.disconnect();
      consumerReadClient.disconnect();
    },
  };
};

/**
 * Picks the offline-delivery read-cursor store. Deliberately Redis-only
 * (docs/adr/2026-08-14-offline-delivery.md): without REDIS_URL, offline
 * delivery is disabled outright via NullReadCursorRepository rather than
 * gaining a single-process fallback - unlike rooms/messageHistory/
 * messageQueue, a cursor that doesn't survive a restart or isn't shared
 * across nodes would misbehave silently, which is worse than the feature
 * simply being unavailable.
 */
const resolveReadCursors = (
  override?: ReadCursorRepository,
): Resolved<ReadCursorRepository> => {
  if (override) {
    return { value: override, close: noClose };
  }

  if (!config.redisUrl) {
    return { value: new NullReadCursorRepository(), close: noClose };
  }

  const client = createRedisClient(config.redisUrl);
  return {
    value: new RedisReadCursorRepository(client),
    close: async () => {
      client.disconnect();
    },
  };
};

/**
 * Picks the per-account joined-room history store
 * (docs/adr/2026-08-17-room-switching.md). Deliberately no in-memory
 * fallback, same reasoning as resolveAuthDatabase: this must survive a
 * restart and follow the user across devices, so a missing real
 * connection is a misconfiguration, not something to silently degrade.
 * Reuses the same Postgres pool already opened for auth rather than a
 * second connection - only possible when that pool is a real `Pool`
 * (production; a test-only Kysely `Dialect` can't run raw SQL), which is
 * why tests exercising this path (e.g. chatFlow.integration.test.ts)
 * pass their own `userRooms` override instead.
 */
const resolveUserRooms = (
  database: AuthDatabase,
  override?: UserRoomsRepository,
): Resolved<UserRoomsRepository> => {
  if (override) {
    return { value: override, close: noClose };
  }

  if (!(database instanceof Pool)) {
    throw new Error(
      'userRooms requires a Pool-backed authDatabase, or an explicit userRooms override',
    );
  }

  return { value: new PostgresUserRoomsRepository(database), close: noClose };
};

/**
 * Composition root: resolves every service `createApp.ts` needs, either
 * from the given override (tests) or from its real, config/env-driven
 * default (production/dev). Extracted from createApp.ts so service
 * wiring can be reasoned about and tested independently of the Express/
 * Socket.io app definition itself (docs/TASK_TRACKER.md Task 6).
 */
export const bootstrap = (deps: BootstrapDeps = {}): Services => {
  const rooms = resolveRooms(deps.rooms);
  const database = resolveAuthDatabase(deps.authDatabase);
  const messageHistory = resolveMessageHistory(deps.messageHistory);
  const messageQueue = resolveMessageQueue(
    messageHistory.value,
    deps.messageQueue,
  );
  const readCursors = resolveReadCursors(deps.readCursors);
  const userRooms = resolveUserRooms(database.value, deps.userRooms);

  const close = async (): Promise<void> => {
    await rooms.close();
    await database.close();
    await messageHistory.close();
    await messageQueue.close();
    await readCursors.close();
    await userRooms.close();
  };

  return {
    rooms: rooms.value,
    adapter: rooms.adapter,
    database: database.value,
    messageHistory: messageHistory.value,
    messageQueue: messageQueue.value,
    readCursors: readCursors.value,
    userRooms: userRooms.value,
    close,
  };
};
