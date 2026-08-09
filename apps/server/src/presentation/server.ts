import config from '../config/index.ts';
import { createApp } from './createApp.ts';

const { httpServer, close } = createApp();

httpServer.listen(config.port, () => {
  console.log(
    `⬆️ Server is up and running on port ${config.port} at ${config.mode} mode`,
  );
  console.log(`ServerSocket waiting for ${config.client}`);
});

const shutdown = async (): Promise<void> => {
  httpServer.close();
  await close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
