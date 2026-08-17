import { createHash } from 'node:crypto';

/** Hex chars kept from the sha256 digest - see roomNameHash's doc comment. */
const HASH_LENGTH = 8;

/** Bounds the human-readable prefix so a very long display name can't
 * produce an unbounded Socket.io room name / storage key. */
const MAX_PREFIX_LENGTH = 60;

/** Unicode combining diacritical marks (U+0300-U+036F) left behind once
 * `normalize('NFKD')` decomposes an accented letter into its base letter
 * plus one of these - e.g. "é" -> "e" + U+0301. */
const COMBINING_MARKS = /[̀-ͯ]/g;

/**
 * Collapses whitespace and case so that incidental differences a human
 * wouldn't consider meaningful - extra spaces, capitalization - don't
 * change the hash. Punctuation, emoji, and diacritics are deliberately
 * NOT stripped here (unlike slugifyPrefix below): keeping them in the
 * hash input is what lets two display names that strip down to the same
 * ASCII prefix (e.g. "Café" and "Cafe", "🎉 General" and "General")
 * still resolve to different slugs instead of silently colliding.
 */
const normalizeForHash = (displayName: string): string =>
  displayName.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Short, deterministic identifier derived from the room's full display
 * name. Deterministic (not random or creation-order-based) so the same
 * display name always maps to the same slug/room without needing a
 * lookup table anywhere - the whole point being that the backend can
 * recompute a room's key from nothing but the name a client sends on
 * `join`, on every node, with no shared state beyond the slug itself.
 * sha256 chosen over a non-cryptographic hash (e.g. FNV-1a) purely for
 * its wide, dependency-free availability via node:crypto and good
 * avalanche behavior at this length - collision resistance beyond
 * "good enough for chat rooms sharing a prefix" was not a goal, see
 * docs/adr/2026-08-16-room-name-slugs.md.
 */
const roomNameHash = (displayName: string): string =>
  createHash('sha256')
    .update(normalizeForHash(displayName))
    .digest('hex')
    .slice(0, HASH_LENGTH);

/**
 * Builds the human-readable part of the slug: lowercase ASCII words
 * joined by hyphens. Diacritics are decomposed and dropped (café ->
 * cafe) and anything left that isn't an ASCII letter, digit, or
 * whitespace (punctuation, symbols, emoji, non-Latin scripts) is
 * discarded outright, per the "only accept numbers and chars from the
 * display name" rule - this keeps the prefix (and therefore the whole
 * slug) trivially URL-safe without any percent-encoding.
 */
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
 * Turns a user-facing room display name (e.g. "CS Study Group") into
 * the URL-safe, ASCII-only name the backend uses internally: as the
 * Socket.io room name, and as the storage key for the room roster
 * (RoomRepository), message history, and read cursors. Always
 * `<readable-prefix>-<hash>`, or just `<hash>` when the display name
 * has no alphanumeric characters at all (e.g. "🎉🎊") - see
 * docs/adr/2026-08-16-room-name-slugs.md for the full rationale,
 * including why the hash is deterministic rather than random.
 *
 * The result is always non-empty and matches `/^[a-z0-9]+(-[a-z0-9]+)*$/`
 * regardless of input, so it's always safe to use directly in a URL path
 * segment, a Redis key, or a Socket.io room name.
 */
export const slugifyRoomName = (displayName: string): string => {
  const prefix = slugifyPrefix(displayName);
  const hash = roomNameHash(displayName);
  return prefix ? `${prefix}-${hash}` : hash;
};
