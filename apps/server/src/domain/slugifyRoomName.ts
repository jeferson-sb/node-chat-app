import { createHash } from 'node:crypto';

const HASH_LENGTH = 8;

/** Bounds the human-readable prefix so a very long display name can't
 * produce an unbounded Socket.io room name / storage key. */
const MAX_PREFIX_LENGTH = 60;

/** Combining diacritical marks (U+0300-U+036F) left behind once
 * `normalize('NFKD')` decomposes an accented letter, e.g. "é" -> "e" + U+0301. */
const COMBINING_MARKS = /[̀-ͯ]/g;

/**
 * Punctuation, emoji, and diacritics are deliberately kept here (unlike
 * slugifyPrefix) so two names that strip down to the same ASCII prefix
 * (e.g. "Café" vs "Cafe") still hash differently and don't collide.
 */
const normalizeForHash = (displayName: string): string =>
  displayName.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Deterministic (not random) so the same display name always maps to the
 * same slug with no lookup table needed - see
 * docs/adr/2026-08-16-room-name-slugs.md.
 */
const roomNameHash = (displayName: string): string =>
  createHash('sha256')
    .update(normalizeForHash(displayName))
    .digest('hex')
    .slice(0, HASH_LENGTH);

const slugifyPrefix = (displayName: string): string =>
  displayName
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .join('-')
    .slice(0, MAX_PREFIX_LENGTH)
    .replace(/-+$/, ''); // a hard slice() can leave a dangling hyphen

/**
 * Turns a user-facing room display name (e.g. "CS Study Group") into the
 * URL-safe, ASCII-only name the backend uses internally for the Socket.io
 * room, roster, history, and read-cursor keys. Always
 * `<readable-prefix>-<hash>`, or just `<hash>` if no alphanumeric
 * characters survive (e.g. "🎉🎊"). See
 * docs/adr/2026-08-16-room-name-slugs.md for the full rationale.
 */
export const slugifyRoomName = (displayName: string): string => {
  const prefix = slugifyPrefix(displayName);
  const hash = roomNameHash(displayName);
  return prefix ? `${prefix}-${hash}` : hash;
};
