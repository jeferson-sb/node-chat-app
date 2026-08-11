import type { MessageSnapshot } from '../../domain/Message.ts';
import type { MessageHistoryRepository } from './MessageHistoryRepository.ts';

/**
 * Single-process message history, matching InMemoryRoomRepository's role
 * for RoomRepository: no persistence across restarts, used when no
 * Scylla cluster is configured (local dev, or tests - see config.ts's
 * scyllaContactPoints and createApp.ts's setupMessageHistory).
 */
export class InMemoryMessageHistoryRepository implements MessageHistoryRepository {
  private readonly messagesByRoom: Map<string, MessageSnapshot[]> = new Map();

  async saveMessage(room: string, message: MessageSnapshot): Promise<void> {
    const messages = this.messagesByRoom.get(room) ?? [];
    messages.push(message);
    this.messagesByRoom.set(room, messages);
  }

  async getRecentMessages(
    room: string,
    limit: number,
  ): Promise<MessageSnapshot[]> {
    const messages = this.messagesByRoom.get(room) ?? [];
    return messages.slice(-limit).reverse();
  }
}
