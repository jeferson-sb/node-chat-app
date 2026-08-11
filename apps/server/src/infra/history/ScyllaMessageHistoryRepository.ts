import type { Client, types } from 'cassandra-driver';
import type { MessageSnapshot } from '../../domain/Message.ts';
import type { MessageHistoryRepository } from './MessageHistoryRepository.ts';

/** Weekly buckets bound partition size for long-lived, busy rooms. */
const BUCKET_SIZE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * How many buckets back to check when reading. A fresh room join can't
 * know in advance how far back `limit` messages live; most rooms will
 * satisfy it from the current bucket alone, but a quiet room needs a few
 * weeks of lookback.
 */
const BUCKET_LOOKBACK = 4;

const bucketFor = (createdAt: number): number =>
  Math.floor(createdAt / BUCKET_SIZE_MS);

/**
 * ScyllaDB-backed chat history (docs/adr/2026-08-11-chat-history-storage.md).
 * Partition key is (room, time bucket); clustering key is created_at DESC,
 * so "last N messages" is a cheap range scan with no secondary index.
 * Manually verified against a real cluster (docker-compose.yml) rather
 * than covered by an automated test - same precedent as
 * RedisRoomRepository (docs/adr/2026-08-09-horizontal-scaling.md), since
 * there's no in-process Scylla the way pglite stands in for Postgres in
 * tests.
 */
export class ScyllaMessageHistoryRepository implements MessageHistoryRepository {
  private readonly client: Client;

  constructor(client: Client) {
    this.client = client;
  }

  async saveMessage(room: string, message: MessageSnapshot): Promise<void> {
    await this.client.execute(
      `INSERT INTO messages (room_id, bucket, created_at, message_id, username, text)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        room,
        bucketFor(message.createdAt),
        new Date(message.createdAt),
        message.id,
        message.username,
        message.text,
      ],
      { prepare: true },
    );
  }

  async getRecentMessages(
    room: string,
    limit: number,
  ): Promise<MessageSnapshot[]> {
    const currentBucket = bucketFor(Date.now());
    const messages: MessageSnapshot[] = [];

    for (let i = 0; i < BUCKET_LOOKBACK && messages.length < limit; i++) {
      const result = await this.client.execute(
        `SELECT message_id, username, text, created_at FROM messages
         WHERE room_id = ? AND bucket = ?
         ORDER BY created_at DESC
         LIMIT ?`,
        [room, currentBucket - i, limit - messages.length],
        { prepare: true },
      );

      messages.push(
        ...result.rows.map((row: types.Row) => ({
          id: (row.get('message_id') as types.Uuid).toString(),
          username: row.get('username') as string,
          text: row.get('text') as string,
          createdAt: (row.get('created_at') as Date).getTime(),
        })),
      );
    }

    return messages;
  }
}
