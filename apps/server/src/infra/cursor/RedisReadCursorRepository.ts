import type { Redis } from 'ioredis';
import type { ReadCursorRepository } from './ReadCursorRepository.ts';

const CURSORS_KEY = 'chatme:read-cursors';

const cursorKey = (room: string, username: string): string =>
  `${room}:${username}`;

/**
 * Redis-backed read cursor store, shared by every server node: one hash
 * (chatme:read-cursors: "room:username" -> lastSeenAt as a string epoch
 * ms), same shape as RedisRoomRepository's membership hash. Manually
 * verified against a running Redis instance rather than covered by an
 * automated test, same precedent as RedisRoomRepository (see
 * docs/adr/2026-08-09-horizontal-scaling.md).
 */
export class RedisReadCursorRepository implements ReadCursorRepository {
  private readonly redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  async getLastSeenAt(
    room: string,
    username: string,
  ): Promise<number | undefined> {
    const raw = await this.redis.hget(CURSORS_KEY, cursorKey(room, username));
    return raw === null ? undefined : Number(raw);
  }

  async markSeen(
    room: string,
    username: string,
    seenAt: number,
  ): Promise<void> {
    await this.redis.hset(
      CURSORS_KEY,
      cursorKey(room, username),
      String(seenAt),
    );
  }
}
