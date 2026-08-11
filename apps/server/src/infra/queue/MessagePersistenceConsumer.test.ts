import { describe, expect, it, vi } from 'vitest';
import { MessagePersistenceConsumer } from './MessagePersistenceConsumer.ts';
import { InMemoryMessageHistoryRepository } from '../history/InMemoryMessageHistoryRepository.ts';

const entry = {
  id: '1-0',
  room: 'general',
  message: { id: 'm1', username: 'alice', text: 'hello', createdAt: 1 },
};

const createStream = () => ({
  ack: vi.fn().mockResolvedValue(undefined),
  deadLetter: vi.fn().mockResolvedValue(undefined),
});

describe('MessagePersistenceConsumer', () => {
  it('persists the entry and acks it on the first successful attempt', async () => {
    const messageHistory = new InMemoryMessageHistoryRepository();
    const stream = createStream();
    const consumer = new MessagePersistenceConsumer({
      messageHistory,
      stream,
      retryDelayMs: () => 0,
    });

    await consumer.processEntry(entry);

    expect(await messageHistory.getRecentMessages('general', 10)).toEqual([
      entry.message,
    ]);
    expect(stream.ack).toHaveBeenCalledWith(entry.id);
    expect(stream.deadLetter).not.toHaveBeenCalled();
  });

  it('retries a failing persist and succeeds without dead-lettering', async () => {
    const messageHistory = new InMemoryMessageHistoryRepository();
    const saveMessage = vi
      .spyOn(messageHistory, 'saveMessage')
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce(undefined);
    const stream = createStream();
    const consumer = new MessagePersistenceConsumer({
      messageHistory,
      stream,
      retryDelayMs: () => 0,
    });

    await consumer.processEntry(entry);

    expect(saveMessage).toHaveBeenCalledTimes(2);
    expect(stream.ack).toHaveBeenCalledWith(entry.id);
    expect(stream.deadLetter).not.toHaveBeenCalled();
  });

  it('dead-letters and acks after exhausting max attempts', async () => {
    const messageHistory = new InMemoryMessageHistoryRepository();
    const saveMessage = vi
      .spyOn(messageHistory, 'saveMessage')
      .mockRejectedValue(new Error('scylla is down'));
    const stream = createStream();
    const consumer = new MessagePersistenceConsumer({
      messageHistory,
      stream,
      maxAttempts: 3,
      retryDelayMs: () => 0,
    });

    await consumer.processEntry(entry);

    expect(saveMessage).toHaveBeenCalledTimes(3);
    expect(stream.deadLetter).toHaveBeenCalledWith(entry);
    expect(stream.ack).toHaveBeenCalledWith(entry.id);
  });
});
