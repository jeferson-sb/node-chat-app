import { describe, expect, it } from 'vitest';
import { slugifyRoomName } from './slugifyRoomName.ts';

/** The slug must always be safe to drop straight into a URL path segment,
 * a Redis key, or a Socket.io room name - see slugifyRoomName's doc
 * comment. */
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

describe('slugifyRoomName', () => {
  it('lowercases and hyphenates a simple display name', () => {
    expect(slugifyRoomName('CS Study Group')).toMatch(
      /^cs-study-group-[0-9a-f]{8}$/,
    );
  });

  it('is case-insensitive - the same name in a different case is the same room', () => {
    expect(slugifyRoomName('CS Study Group')).toBe(
      slugifyRoomName('cs study group'),
    );
    expect(slugifyRoomName('CS Study Group')).toBe(
      slugifyRoomName('Cs StUdY GrOuP'),
    );
  });

  it('ignores leading, trailing, and repeated whitespace', () => {
    expect(slugifyRoomName('  Math    Class  ')).toBe(
      slugifyRoomName('Math Class'),
    );
  });

  it('strips diacritics from the readable prefix', () => {
    expect(slugifyRoomName('Café Münchën')).toMatch(
      /^cafe-munchen-[0-9a-f]{8}$/,
    );
  });

  it('disambiguates names that only differ in stripped diacritics', () => {
    // Both "Café" and "Cafe" reduce to the same readable prefix, but they
    // are meaningfully different display names - the hash (computed from
    // the un-stripped, only case/whitespace-normalized name) keeps their
    // slugs apart instead of merging the two rooms.
    const withAccent = slugifyRoomName('Café');
    const withoutAccent = slugifyRoomName('Cafe');

    expect(withAccent).not.toBe(withoutAccent);
    expect(withAccent).toMatch(/^cafe-[0-9a-f]{8}$/);
    expect(withoutAccent).toMatch(/^cafe-[0-9a-f]{8}$/);
  });

  it('strips punctuation from the readable prefix', () => {
    expect(slugifyRoomName('Hello, World!!')).toMatch(
      /^hello-world-[0-9a-f]{8}$/,
    );
  });

  it('strips emoji entirely, keeping only the readable words', () => {
    expect(slugifyRoomName('🎉 Party Room 🎊')).toMatch(
      /^party-room-[0-9a-f]{8}$/,
    );
  });

  it('disambiguates names that only differ by emoji', () => {
    const withEmoji = slugifyRoomName('🎉 General');
    const withoutEmoji = slugifyRoomName('General');

    expect(withEmoji).not.toBe(withoutEmoji);
    expect(withEmoji).toMatch(/^general-[0-9a-f]{8}$/);
  });

  it('keeps numbers from the display name', () => {
    expect(slugifyRoomName('Room 42')).toMatch(/^room-42-[0-9a-f]{8}$/);
  });

  it('falls back to a bare hash when nothing alphanumeric survives', () => {
    expect(slugifyRoomName('!!!@@@###')).toMatch(/^[0-9a-f]{8}$/);
    expect(slugifyRoomName('🎉🎊')).toMatch(/^[0-9a-f]{8}$/);
  });

  it('produces a non-empty slug for an empty display name', () => {
    const slug = slugifyRoomName('');
    expect(slug).toMatch(/^[0-9a-f]{8}$/);
    expect(slug.length).toBeGreaterThan(0);
  });

  it('produces a non-empty slug for a whitespace-only display name', () => {
    expect(slugifyRoomName('   ')).toMatch(/^[0-9a-f]{8}$/);
  });

  it('is deterministic - calling it twice with the same name gives the same slug', () => {
    expect(slugifyRoomName('CS Study Group')).toBe(
      slugifyRoomName('CS Study Group'),
    );
  });

  it('bounds the readable prefix for a very long display name', () => {
    const veryLongName = 'word '.repeat(50).trim();

    const slug = slugifyRoomName(veryLongName);

    // 60-char prefix cap + hyphen + 8-char hash, comfortably under any
    // reasonable URL path segment / Redis key length limit.
    expect(slug.length).toBeLessThanOrEqual(69);
    expect(slug).not.toMatch(/-$/);
  });

  it('gives two rooms with the same display name the same slug', () => {
    // Not a bug: re-typing the exact same display name is expected to
    // land back in the exact same room, deterministically, with no
    // lookup table involved (docs/adr/2026-08-16-room-name-slugs.md).
    const first = slugifyRoomName('General Chat');
    const second = slugifyRoomName('General Chat');

    expect(first).toBe(second);
  });

  it('gives two different display names different slugs', () => {
    expect(slugifyRoomName('General Chat')).not.toBe(
      slugifyRoomName('Random Chat'),
    );
  });

  it('always returns a URL-safe, Redis-key-safe, Socket.io-room-safe slug', () => {
    const inputs = [
      'CS Study Group',
      'Café Münchën',
      'Hello, World!!',
      '🎉 Party Room 🎊',
      '!!!@@@###',
      '',
      '   ',
      'Room 42',
      'word '.repeat(50).trim(),
    ];

    for (const input of inputs) {
      expect(slugifyRoomName(input)).toMatch(SLUG_PATTERN);
    }
  });
});
