import type { MessageSnapshot } from '../../domain/Message.ts';
import type { MessageHistoryRepository } from '../history/MessageHistoryRepository.ts';

export type PendingEntry = {
  id: string;
  room: string;
  message: MessageSnapshot;
};

/**
 * The minimal ack/dead-letter surface the consumer needs from the queue
 * backend (Redis Streams in production, see docs/adr/2026-08-11-message-
 * queue-persistence.md). Kept separate from the queue's own producer-side
 * MessageQueue interface since only the consumer side needs it.
 */
export type ConsumerStream = {
  ack(entryId: string): Promise<void>;
  deadLetter(entry: PendingEntry): Promise<void>;
};

export type MessagePersistenceConsumerDeps = {
  messageHistory: MessageHistoryRepository;
  stream: ConsumerStream;
  /** Give up and dead-letter after this many attempts. Default: 5. */
  maxAttempts?: number;
  /** Backoff schedule between attempts, keyed by attempt number (1-based). */
  retryDelayMs?: (attempt: number) => number;
};

const DEFAULT_MAX_ATTEMPTS = 5;
const defaultRetryDelayMs = (attempt: number): number =>
  100 * 2 ** (attempt - 1);

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Persists one queued message, retrying transient failures with backoff
 * before giving up and moving the entry to the dead-letter stream so a
 * persistently-broken message can't stall the whole consumer group behind
 * it (docs/adr/2026-08-11-message-queue-persistence.md). The Redis Streams
 * read loop that feeds entries here is thin wiring, verified manually
 * against a real cluster - this class holds the actual retry/dead-letter
 * decision, which is why it's unit-tested in isolation from Redis.
 */
export class MessagePersistenceConsumer {
  private readonly messageHistory: MessageHistoryRepository;
  private readonly stream: ConsumerStream;
  private readonly maxAttempts: number;
  private readonly retryDelayMs: (attempt: number) => number;

  constructor({
    messageHistory,
    stream,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    retryDelayMs = defaultRetryDelayMs,
  }: MessagePersistenceConsumerDeps) {
    this.messageHistory = messageHistory;
    this.stream = stream;
    this.maxAttempts = maxAttempts;
    this.retryDelayMs = retryDelayMs;
  }

  async processEntry(entry: PendingEntry): Promise<void> {
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        await this.messageHistory.saveMessage(entry.room, entry.message);
        await this.stream.ack(entry.id);
        return;
      } catch (error) {
        if (attempt === this.maxAttempts) {
          console.error(
            `[MessagePersistenceConsumer]: giving up on entry ${entry.id} after ${attempt} attempts, dead-lettering`,
            error,
          );
          await this.stream.deadLetter(entry);
          await this.stream.ack(entry.id);
          return;
        }

        await wait(this.retryDelayMs(attempt));
      }
    }
  }
}
