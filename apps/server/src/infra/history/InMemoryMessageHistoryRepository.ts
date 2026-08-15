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

  async getMessagesSince(
    room: string,
    sinceAt: number,
    limit: number,
  ): Promise<MessageSnapshot[]> {
    const messages = this.messagesByRoom.get(room) ?? [];
    const missed: MessageSnapshot[] = [];

    // Walk backward from the newest message and stop as soon as we're
    // past the cursor, instead of filtering the room's entire history
    // every call - a reconnecting user typically missed a handful of
    // messages, not the whole room's lifetime.
    for (let i = messages.length - 1; i >= 0 && missed.length < limit; i--) {
      const message = messages[i];
      if (!message || message.createdAt <= sinceAt) break;
      missed.push(message);
    }

    return missed;
  }
}
