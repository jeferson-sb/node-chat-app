import type { MessageSnapshot } from '../../domain/Message.ts';

export type MessageHistoryRepository = {
  saveMessage(room: string, message: MessageSnapshot): Promise<void>;
  getRecentMessages(room: string, limit: number): Promise<MessageSnapshot[]>;
};
