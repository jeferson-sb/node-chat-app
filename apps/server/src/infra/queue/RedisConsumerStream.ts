import type { Redis } from 'ioredis';
import type {
  ConsumerStream,
  PendingEntry,
} from './MessagePersistenceConsumer.ts';
import {
  CONSUMER_GROUP,
  DEAD_LETTER_STREAM_KEY,
  PENDING_STREAM_KEY,
} from './redisStreamKeys.ts';

/**
 * Redis-backed ack/dead-letter side consumed by MessagePersistenceConsumer.
 * Thin wiring around XACK/XADD, verified manually against docker-compose's
 * Redis service - same convention as RedisMessageQueue.ts.
 */
export class RedisConsumerStream implements ConsumerStream {
  private readonly redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  async ack(entryId: string): Promise<void> {
    await this.redis.xack(PENDING_STREAM_KEY, CONSUMER_GROUP, entryId);
  }

  async deadLetter(entry: PendingEntry): Promise<void> {
    await this.redis.xadd(
      DEAD_LETTER_STREAM_KEY,
      '*',
      'room',
      entry.room,
      'message',
      JSON.stringify(entry.message),
      'originalId',
      entry.id,
    );
  }
}
