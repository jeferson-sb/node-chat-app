import config from '../config/index.ts';
import { createApp } from './createApp.ts';
import { registerGracefulShutdown } from './gracefulShutdown.ts';

const { httpServer, close } = createApp();

httpServer.listen(config.port, () => {
  console.log(
    `⬆️ Server is up and running on port ${config.port} at ${config.mode} mode`,
  );
  console.log(`ServerSocket waiting for ${config.client}`);
});

registerGracefulShutdown(close);
