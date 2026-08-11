import dotenv from 'dotenv';

dotenv.config();

export type Config = {
  port: string | number;
  mode: string | undefined;
  client: string;
  redisUrl: string | undefined;
  databaseUrl: string | undefined;
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
};

export default config;
