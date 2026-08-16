import dotenv from 'dotenv';

dotenv.config();

export type Config = {
  port: string | number;
  mode: string | undefined;
  client: string;
  redisUrl: string | undefined;
  databaseUrl: string | undefined;
  authSecret: string | undefined;
  scyllaContactPoints: string[] | undefined;
  scyllaLocalDataCenter: string;
};

const config: Config = {
  port: process.env.PORT || 8080,
  mode: process.env.NODE_ENV,
  client: process.env.CLIENT_APP_URL || 'http://localhost',
  redisUrl: process.env.REDIS_URL,
  databaseUrl: process.env.DATABASE_URL,
  authSecret: process.env.BETTER_AUTH_SECRET,
  scyllaContactPoints: process.env.SCYLLA_CONTACT_POINTS?.split(',').map(
    (point) => point.trim(),
  ),
  scyllaLocalDataCenter: process.env.SCYLLA_LOCAL_DATACENTER || 'datacenter1',
} as const;

export default config;
