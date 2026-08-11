import type { Redis } from 'ioredis';
import type { MessageSnapshot } from '../../domain/Message.ts';
import type {
  MessagePersistenceConsumer,
  PendingEntry,
} from './MessagePersistenceConsumer.ts';
import { CONSUMER_GROUP, PENDING_STREAM_KEY } from './redisStreamKeys.ts';

const READ_COUNT = 10;
const READ_BLOCK_MS = 5_000;

// A single-stream XREADGROUP reply comes back as one flat [key, entries]
// pair (not an array of pairs) via ioredis's RESP3 handling - confirmed
// empirically against a real Redis instance, since this diverges from
// RESP2's documented shape and there's exactly one stream to ever read.
type RawStreamEntries = [string, [string, string[]][]];

const parseEntry = (id: string, fields: string[]): PendingEntry => {
  const values = new Map<string, string>();
  for (let i = 0; i < fields.length; i += 2) {
    values.set(fields[i] as string, fields[i + 1] as string);
  }

  const room = values.get('room');
  const rawMessage = values.get('message');
  if (!room || !rawMessage) {
    throw new Error(
      `malformed pending stream entry ${id}: missing room/message`,
    );
  }

  return { id, room, message: JSON.parse(rawMessage) as MessageSnapshot };
};

/**
 * Reads chatme:messages:pending via a blocking XREADGROUP loop and hands
 * each entry to MessagePersistenceConsumer. One instance runs in-process
 * per @chatme/server replica, all sharing CONSUMER_GROUP, so any replica
 * can pick up any pending entry (docs/adr/2026-08-11-message-queue-
 * persistence.md). Thin wiring, verified manually against docker-compose
 * - the retry/dead-letter decision this loop delegates to is what's
 * actually unit-tested (MessagePersistenceConsumer.test.ts).
 *
 * Needs its own Redis connection: BLOCK ties up the connection for up to
 * READ_BLOCK_MS, which would otherwise stall unrelated commands (XADD,
 * XACK) sharing that connection.
 */
export class RedisMessagePersistenceRunner {
  private readonly redis: Redis;
  private readonly consumer: MessagePersistenceConsumer;
  private readonly consumerName: string;
  private running = false;
  private loopPromise: Promise<void> = Promise.resolve();

  constructor(
    redis: Redis,
    consumer: MessagePersistenceConsumer,
    consumerName = `consumer-${process.pid}`,
  ) {
    this.redis = redis;
    this.consumer = consumer;
    this.consumerName = consumerName;
  }

  async start(): Promise<void> {
    await this.ensureConsumerGroup();
    this.running = true;
    this.loopPromise = this.loop();
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.loopPromise;
  }

  private async ensureConsumerGroup(): Promise<void> {
    try {
      await this.redis.xgroup(
        'CREATE',
        PENDING_STREAM_KEY,
        CONSUMER_GROUP,
        '$',
        'MKSTREAM',
      );
    } catch (error) {
      const isAlreadyExists =
        error instanceof Error && error.message.includes('BUSYGROUP');
      if (!isAlreadyExists) {
        throw error;
      }
    }
  }

  private async loop(): Promise<void> {
    while (this.running) {
      const result = (await this.redis.call('XREADGROUP', [
        'GROUP',
        CONSUMER_GROUP,
        this.consumerName,
        'COUNT',
        String(READ_COUNT),
        'BLOCK',
        String(READ_BLOCK_MS),
        'STREAMS',
        PENDING_STREAM_KEY,
        '>',
      ])) as RawStreamEntries | null;

      if (!result) {
        continue;
      }

      const [, entries] = result;
      for (const [id, fields] of entries) {
        await this.consumer.processEntry(parseEntry(id, fields));
      }
    }
  }
}
