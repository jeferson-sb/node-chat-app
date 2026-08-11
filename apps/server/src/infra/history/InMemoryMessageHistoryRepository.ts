import type { MessageSnapshot } from '../../domain/Message.ts';
import type { MessageHistoryRepository } from './MessageHistoryRepository.ts';

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
