import type { MessageSnapshot } from '../../domain/Message.ts';
import type { MessageHistoryRepository } from '../history/MessageHistoryRepository.ts';
import type { MessageQueue } from './MessageQueue.ts';

export class InMemoryMessageQueue implements MessageQueue {
  private readonly messageHistory: MessageHistoryRepository;

  constructor(messageHistory: MessageHistoryRepository) {
    this.messageHistory = messageHistory;
  }

  enqueue(room: string, message: MessageSnapshot): Promise<void> {
    return this.messageHistory.saveMessage(room, message);
  }
}
