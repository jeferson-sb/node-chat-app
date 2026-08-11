/**
 * Shared between the producer (RedisMessageQueue), the consumer's ack/
 * dead-letter side (RedisConsumerStream), and the read loop
 * (RedisMessagePersistenceRunner) - see
 * docs/adr/2026-08-11-message-queue-persistence.md.
 */
export const PENDING_STREAM_KEY = 'chatme:messages:pending';
export const DEAD_LETTER_STREAM_KEY = 'chatme:messages:dead';
export const CONSUMER_GROUP = 'chatme-history-writers';

/**
 * Approximate cap on the pending stream so a sustained ScyllaDB outage
 * can't grow Redis memory without bound - sized well above normal
 * traffic. Accepted risk: an extreme, prolonged backlog could drop the
 * oldest still-unpersisted messages (see the ADR's Consequences).
 */
export const PENDING_STREAM_MAXLEN = 100_000;
