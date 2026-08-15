import type { MessageSnapshot } from '../../domain/Message.ts';

export type MessageHistoryRepository = {
  saveMessage(room: string, message: MessageSnapshot): Promise<void>;
  getRecentMessages(room: string, limit: number): Promise<MessageSnapshot[]>;
  /**
   * Messages sent after `sinceAt`, newest first, capped at `limit` - used
   * to backfill a reconnecting user with only what they missed while
   * offline (docs/adr/2026-08-14-offline-delivery.md) instead of always
   * replaying a fixed window of recent history.
   */
  getMessagesSince(
    room: string,
    sinceAt: number,
    limit: number,
  ): Promise<MessageSnapshot[]>;
};
