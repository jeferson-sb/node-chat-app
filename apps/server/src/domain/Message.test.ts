import { describe, expect, it } from 'vitest';
import { Message } from './Message.ts';

describe('Message', () => {
  it('creates a snapshot with the given props', () => {
    const message = Message.from({
      id: '1',
      username: 'alice',
      text: 'hello',
      createdAt: 1700000000000,
    });

    expect(message.snapshot()).toEqual({
      id: '1',
      username: 'alice',
      text: 'hello',
      createdAt: 1700000000000,
    });
  });

  it('exposes each prop via its own getter', () => {
    const message = Message.from({
      id: '2',
      username: 'bob',
      text: 'hi',
      createdAt: 42,
    });

    expect(message.id).toBe('2');
    expect(message.username).toBe('bob');
    expect(message.text).toBe('hi');
    expect(message.createdAt).toBe(42);
  });
});
