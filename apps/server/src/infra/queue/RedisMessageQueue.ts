import type { Redis } from 'ioredis';
import type { MessageSnapshot } from '../../domain/Message.ts';
import type { MessageQueue } from './MessageQueue.ts';
import {
  PENDING_STREAM_KEY,
  PENDING_STREAM_MAXLEN,
} from './redisStreamKeys.ts';

/**
 * Producer side of the Redis Streams queue
 * (docs/adr/2026-08-11-message-queue-persistence.md). Thin wiring around
 * XADD, verified manually against docker-compose's Redis service - same
 * "no dedicated unit test" convention as RedisRoomRepository.ts.
 */
export class RedisMessageQueue implements MessageQueue {
  private readonly redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  async enqueue(room: string, message: MessageSnapshot): Promise<void> {
    await this.redis.xadd(
      PENDING_STREAM_KEY,
      'MAXLEN',
      '~',
      String(PENDING_STREAM_MAXLEN),
      '*',
      'room',
      room,
      'message',
      JSON.stringify(message),
    );
  }
}
