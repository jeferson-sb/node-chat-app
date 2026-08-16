import { describe, expect, it } from 'vitest';
import { mergeHistory } from './mergeHistory.ts';
import type { MessageSnapshot } from '../../domain/Message.ts';

const message = (id: string, createdAt: number): MessageSnapshot => ({
  id,
  username: 'bob',
  text: `message ${id}`,
  createdAt,
});

describe('mergeHistory', () => {
  it('returns the recent window unchanged when there is nothing missed', () => {
    const recent = [message('2', 200), message('1', 100)];

    expect(mergeHistory(recent, [], 50)).toEqual(recent);
  });

  it('keeps one copy of a message present in both', () => {
    const overlapping = message('2', 200);

    const merged = mergeHistory(
      [overlapping, message('1', 100)],
      [overlapping],
      50,
    );

    expect(merged.map(({ id }) => id)).toEqual(['2', '1']);
  });

  // The case the merge exists for - see BUCKET_LOOKBACK in
  // ScyllaMessageHistoryRepository.
  it('includes missed messages the recent window did not reach', () => {
    const merged = mergeHistory([], [message('1', 100)], 50);

    expect(merged).toEqual([message('1', 100)]);
  });

  it('orders newest first across both sources', () => {
    const merged = mergeHistory(
      [message('3', 300), message('1', 100)],
      [message('2', 200)],
      50,
    );

    expect(merged.map(({ id }) => id)).toEqual(['3', '2', '1']);
  });

  it('caps the merged result at the limit, keeping the newest', () => {
    const merged = mergeHistory(
      [message('3', 300), message('2', 200)],
      [message('1', 100)],
      2,
    );

    expect(merged.map(({ id }) => id)).toEqual(['3', '2']);
  });
});
