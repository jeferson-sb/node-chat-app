import { Client } from 'cassandra-driver';
import config from '../../config/index.ts';

/**
 * Idempotent schema setup for the ScyllaDB-backed chat history
 * (docs/adr/2026-08-11-chat-history-storage.md). There's no CLI tool for
 * Scylla/Cassandra the way Better Auth's CLI covers Postgres migrations
 * (apps/server/src/auth.ts), so this is a small script run manually or at
 * deploy time: `pnpm run db:migrate:scylla`.
 */
if (!config.scyllaContactPoints) {
  throw new Error('SCYLLA_CONTACT_POINTS is required to run this migration');
}

const client = new Client({
  contactPoints: config.scyllaContactPoints,
  localDataCenter: config.scyllaLocalDataCenter,
});

await client.connect();

await client.execute(`
  CREATE KEYSPACE IF NOT EXISTS chatme
  WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 3}
`);

await client.execute(`
  CREATE TABLE IF NOT EXISTS chatme.messages (
    room_id text,
    bucket int,
    created_at timestamp,
    message_id uuid,
    username text,
    text text,
    PRIMARY KEY ((room_id, bucket), created_at, message_id)
  ) WITH CLUSTERING ORDER BY (created_at DESC)
`);

console.log('ScyllaDB schema ready (keyspace "chatme", table "messages")');
await client.shutdown();
