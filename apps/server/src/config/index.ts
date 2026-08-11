import dotenv from 'dotenv';

dotenv.config();

export type Config = {
  port: string | number;
  mode: string | undefined;
  client: string;
  redisUrl: string | undefined;
  databaseUrl: string | undefined;
  scyllaContactPoints: string[] | undefined;
  scyllaLocalDataCenter: string;
};

const config: Config = {
  port: process.env.PORT || 8080,
  mode: process.env.NODE_ENV,
  client: process.env.CLIENT_APP_URL || 'http://localhost',
  // Shared room state (RoomRepository) and cross-node broadcast (the
  // socket.io Redis adapter) both need this; unset means "single
  // process, no multi-node support" (see setupSocketServer).
  redisUrl: process.env.REDIS_URL,
  // Backs Better Auth (see infra/auth/createAuth.ts). Unlike redisUrl,
  // there's no in-process fallback: accounts are mandatory (see
  // docs/adr/2026-08-09-authentication.md), so createApp() throws at
  // startup if this is unset.
  databaseUrl: process.env.DATABASE_URL,
  // Backs chat history (see infra/history/). Unset means no persisted
  // history - falls back to InMemoryMessageHistoryRepository, same
  // graceful-degrade pattern as redisUrl (see
  // docs/adr/2026-08-11-chat-history-storage.md).
  scyllaContactPoints: process.env.SCYLLA_CONTACT_POINTS?.split(',').map(
    (point) => point.trim(),
  ),
  scyllaLocalDataCenter: process.env.SCYLLA_LOCAL_DATACENTER || 'datacenter1',
};

export default config;
