import config from '../config/index.ts';
import { createApp } from './createApp.ts';
import { registerGracefulShutdown } from './gracefulShutdown.ts';
import { logger } from '../infra/logging/createLogger.ts';

const { httpServer, close } = createApp();

httpServer.listen(config.port, () => {
  logger.info(
    { port: config.port, mode: config.mode, client: config.client },
    'server is up and running',
  );
});

registerGracefulShutdown(close);
