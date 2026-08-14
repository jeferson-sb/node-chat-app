import { logger } from '../infra/logging/createLogger.ts';

export type GracefulShutdownOptions = {
  /**
   * Max time to wait for `close()` to resolve before forcing an exit
   * anyway - a hung Redis/Postgres/Scylla connection during teardown
   * would otherwise leave the process running forever instead of
   * actually shutting down. Defaults to 10s.
   */
  forceExitAfterMs?: number;
  /** Injection seam for tests - defaults to the real Node process. */
  process?: Pick<NodeJS.Process, 'on' | 'exit'>;
};

/**
 * Wires SIGINT/SIGTERM (sent by `docker compose stop`, Ctrl+C, and
 * orchestrators like Kubernetes on pod termination) to `close()` -
 * createApp.ts's aggregated teardown that force-disconnects every open
 * Socket.io connection, closes the underlying HTTP server, and closes
 * whatever real backing-service connections (Redis, Postgres, Scylla)
 * bootstrap.ts opened. Without this, the process exits immediately on
 * signal, abruptly dropping every connected client and leaving those
 * connections (and any in-flight persistence writes) unclosed.
 *
 * A signal received while already shutting down is ignored, since a
 * process manager sending SIGTERM followed shortly by SIGKILL (or a
 * user hitting Ctrl+C twice) shouldn't restart the same teardown
 * concurrently with itself.
 */
export const registerGracefulShutdown = (
  close: () => Promise<void>,
  {
    forceExitAfterMs = 10_000,
    process: proc = process,
  }: GracefulShutdownOptions = {},
): void => {
  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info({ signal }, 'received signal, shutting down gracefully');

    const forceExitTimer = setTimeout(() => {
      logger.error(
        { forceExitAfterMs },
        'graceful shutdown exceeded timeout, forcing exit',
      );
      proc.exit(1);
    }, forceExitAfterMs);

    try {
      await close();
      clearTimeout(forceExitTimer);
      proc.exit(0);
    } catch (error) {
      logger.error({ err: error }, 'error during graceful shutdown');
      clearTimeout(forceExitTimer);
      proc.exit(1);
    }
  };

  proc.on('SIGINT', () => shutdown('SIGINT'));
  proc.on('SIGTERM', () => shutdown('SIGTERM'));
};
