import type { MessageSnapshot } from '../../domain/Message.ts';

/**
 * Combines the recent window with what a reconnecting user missed into
 * the newest-first snapshot `history` carries
 * (docs/adr/2026-08-15-history-snapshot-on-join.md). The two usually
 * overlap; they diverge when a room is quieter than
 * ScyllaMessageHistoryRepository's BUCKET_LOOKBACK reaches.
 */
export const mergeHistory = (
  recent: MessageSnapshot[],
  missed: MessageSnapshot[],
  limit: number,
): MessageSnapshot[] => {
  const byId = new Map<string, MessageSnapshot>();

  for (const message of [...recent, ...missed]) {
    byId.set(message.id, message);
  }

  return [...byId.values()]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
};
