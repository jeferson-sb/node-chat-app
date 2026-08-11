import type { MessageSnapshot } from '../../domain/Message.ts';
import type { MessageHistoryRepository } from '../history/MessageHistoryRepository.ts';
import type { MessageQueue } from './MessageQueue.ts';

/**
 * Single-process fallback matching InMemoryRoomRepository/
 * InMemoryMessageHistoryRepository's role: no real queueing, used when
 * REDIS_URL is unset (local dev, tests - see createApp.ts's
 * setupMessageQueue). A single process has no cross-node write to buffer
 * against, so it persists directly and synchronously.
 */
export class InMemoryMessageQueue implements MessageQueue {
  private readonly messageHistory: MessageHistoryRepository;

  constructor(messageHistory: MessageHistoryRepository) {
    this.messageHistory = messageHistory;
  }

  enqueue(room: string, message: MessageSnapshot): Promise<void> {
    return this.messageHistory.saveMessage(room, message);
  }
}
