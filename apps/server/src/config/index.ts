import dotenv from 'dotenv';

dotenv.config();

export type Config = {
  port: string | number;
  mode: string | undefined;
  client: string;
};

const config: Config = {
  port: process.env.PORT || 8080,
  mode: process.env.NODE_ENV,
  client: process.env.CLIENT_APP_URL || 'http://localhost',
};

export default config;
