import type { ReadCursorRepository } from './ReadCursorRepository.ts';

/**
 * No-op cursor store used when REDIS_URL isn't configured (see
 * resolveReadCursors in bootstrap.ts and docs/adr/2026-08-14-offline-
 * delivery.md). getLastSeenAt always reports "no cursor yet", so
 * SocketController.onJoinRoom falls back to its existing fixed-window
 * getRecentMessages - offline delivery is simply unavailable in a
 * single-process/no-Redis setup rather than gaining a fallback that
 * wouldn't survive a restart or be shared across nodes anyway.
 */
export class NullReadCursorRepository implements ReadCursorRepository {
  async getLastSeenAt(): Promise<number | undefined> {
    return undefined;
  }

  async markSeen(): Promise<void> {}
}
