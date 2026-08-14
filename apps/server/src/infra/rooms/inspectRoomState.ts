import { createRedisClient } from '../redis/createRedisClient.ts';
import config from '../../config/index.ts';
import type { ChatUser } from '../../domain/ChatUser.ts';

const MEMBERS_KEY = 'chatme:members';
const SOCKET_INDEX_KEY = 'chatme:socket-index';

/**
 * Standalone chat-ops script to inspect the live room roster held in
 * Redis (RedisRoomRepository.ts) - e.g. to check why a user's sidebar
 * indicator looks wrong, or to see how many members/sockets a room
 * currently has across every node behind Nginx
 * (docs/adr/2026-08-09-horizontal-scaling.md). Reads the same two hashes
 * RedisRoomRepository itself uses, directly, rather than going through
 * the repository interface, since this needs the raw socket-index
 * mapping too (RoomRepository has no method exposing that).
 *
 * Requires REDIS_URL, the same as RedisRoomRepository requires it - if
 * unset, the app is running the single-process InMemoryRoomRepository
 * instead, which has no state outside that process for this script to
 * read.
 *
 * Usage:
 *   pnpm run debug:rooms            # every room
 *   pnpm run debug:rooms general    # only the "general" room
 */
if (!config.redisUrl) {
  throw new Error(
    'REDIS_URL is required to inspect room state (the app is using the in-memory room repository, which has no state to inspect from outside its own process)',
  );
}

const roomFilter = process.argv[2];
const redis = createRedisClient(config.redisUrl);

const membersRaw = await redis.hgetall(MEMBERS_KEY);
const socketIndexRaw = await redis.hgetall(SOCKET_INDEX_KEY);

const members = Object.entries(membersRaw)
  .map(([membershipKey, raw]) => ({
    membershipKey,
    user: JSON.parse(raw) as ChatUser,
  }))
  .filter(({ user }) => !roomFilter || user.room === roomFilter);

const rows = members.map(({ membershipKey, user }) => ({
  room: user.room,
  username: user.username,
  socketId: user.socketId,
  online: user.online,
  membershipKey,
}));

console.log(
  roomFilter
    ? `Room roster for "${roomFilter}" (${rows.length} member(s)):`
    : `Full room roster (${rows.length} member(s) across all rooms):`,
);
console.table(rows);

const onlineCount = rows.filter((row) => row.online).length;
const roomCount = new Set(rows.map((row) => row.room)).size;

console.log(
  `Online: ${onlineCount} / ${rows.length}` +
    (roomFilter ? '' : ` across ${roomCount} room(s)`),
);

// A socket-index entry is orphaned if markUserOffline's hdel never ran
// for it (e.g. the process crashed between hset and hdel) and its
// membership was since overwritten by a different socketId - harmless
// (findUserByUsername/getUsersInRoom never read this hash), but worth
// surfacing since it means this socketId's entry can never be resolved
// by markUserOffline again.
const orphanedSocketIndexEntries = Object.entries(socketIndexRaw).filter(
  ([, membershipKey]) => membersRaw[membershipKey] === undefined,
);

console.log(
  `Socket-index entries: ${Object.keys(socketIndexRaw).length} total, ${orphanedSocketIndexEntries.length} orphaned`,
);

redis.disconnect();
