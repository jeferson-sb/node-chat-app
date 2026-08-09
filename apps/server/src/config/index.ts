import dotenv from 'dotenv';

dotenv.config();

export type Config = {
  port: string | number;
  mode: string | undefined;
  client: string;
  redisUrl: string | undefined;
};

const config: Config = {
  port: process.env.PORT || 8080,
  mode: process.env.NODE_ENV,
  client: process.env.CLIENT_APP_URL || 'http://localhost',
  // Shared room state (RoomRepository) and cross-node broadcast (the
  // socket.io Redis adapter) both need this; unset means "single
  // process, no multi-node support" (see setupSocketServer).
  redisUrl: process.env.REDIS_URL,
};

export default config;
