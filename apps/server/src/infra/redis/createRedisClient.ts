import { Redis } from 'ioredis';

/**
 * Single shared entry point for creating ioredis clients, so createApp.ts
 * doesn't need to know ioredis-specific construction details. Used both
 * for the RoomRepository's general commands (hset/hget/...) and, via
 * .duplicate(), for the socket.io Redis adapter's pub/sub clients — see
 * createApp.ts.
 */
export const createRedisClient = (redisUrl: string): Redis =>
  new Redis(redisUrl);
