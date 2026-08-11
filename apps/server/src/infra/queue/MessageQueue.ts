import type { MessageSnapshot } from '../../domain/Message.ts';

/**
 * Buffers chat history writes so a slow or unreachable ScyllaDB doesn't
 * block real-time delivery or lose messages outright (see
 * docs/adr/2026-08-11-message-queue-persistence.md). Read access to
 * history is unaffected - SocketController still reads straight from
 * MessageHistoryRepository, since this queue only sits in front of writes.
 */
export type MessageQueue = {
  enqueue(room: string, message: MessageSnapshot): Promise<void>;
};
