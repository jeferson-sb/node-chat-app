import pino, { type Logger } from 'pino';
import config from '../../config/index.ts';

/**
 * Single shared entry point for creating the app's Pino logger, mirroring
 * createRedisClient.ts's role for ioredis: callers don't need to know
 * Pino-specific construction details (transport, level).
 *
 * Structured JSON in production (one line per log, easy to ship to a log
 * aggregator and to correlate across the multiple server replicas this
 * app runs behind Nginx - docs/adr/2026-08-09-horizontal-scaling.md, where
 * plain console output from each node would be indistinguishable once
 * interleaved). Pretty-printed in development for local readability.
 */
export const createLogger = (): Logger =>
  pino({
    level: process.env.LOG_LEVEL || 'info',
    transport:
      config.mode === 'development'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
  });

export const logger: Logger = createLogger();
