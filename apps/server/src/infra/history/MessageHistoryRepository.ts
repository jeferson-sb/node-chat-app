import type { MessageSnapshot } from '../../domain/Message.ts';

/**
 * Persisted chat history storage, abstracted so SocketController can run
 * against either an in-memory store (local dev, tests - no persistence
 * across restarts) or a ScyllaDB-backed store (see
 * docs/adr/2026-08-11-chat-history-storage.md). Only real user messages
 * are saved here - the synthetic Admin/Server join/welcome/leave messages
 * SocketController builds are not, since they're regenerated from
 * RoomRepository state on every join/disconnect rather than being part
 * of the conversation itself.
 */
export type MessageHistoryRepository = {
  saveMessage(room: string, message: MessageSnapshot): Promise<void>;
  /** Most recent first, capped at `limit`. */
  getRecentMessages(room: string, limit: number): Promise<MessageSnapshot[]>;
};
