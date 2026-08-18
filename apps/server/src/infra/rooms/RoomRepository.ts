import type { ChatUser } from '../../domain/ChatUser.ts';
import type { RoomConfig, RoomConfigLookup } from '../../domain/Room.ts';

/**
 * Room roster storage, abstracted so SocketController can run against
 * either a single-process in-memory store or a Redis-backed store shared
 * by every server node behind a load balancer. Without a shared store,
 * each node would only know about the users that joined through it,
 * breaking the sidebar user list and username-uniqueness check for any
 * room split across nodes.
 *
 * Keyed by (room, username) membership rather than by socketId - a
 * membership record is created on a user's first join to a room and
 * updated in place (never deleted) on every later join/disconnect, so
 * the sidebar can show an online/offline indicator instead of losing the
 * user entirely on disconnect. See
 * docs/adr/2026-08-12-presence-indicators.md.
 */
export type RoomRepository = {
  /**
   * Upserts the (room, username) membership as online with the given
   * socketId. Returns true only if this is the user's first-ever join to
   * that room, which is what SocketController uses to decide whether to
   * broadcast the "has joined" message.
   */
  addUser(user: ChatUser): Promise<boolean>;
  /**
   * Flips the membership matching this socketId to offline. Returns the
   * now-offline user, or undefined if the socketId isn't tracked (e.g. a
   * duplicate/late disconnect event).
   */
  markUserOffline(socketId: string): Promise<ChatUser | undefined>;
  /**
   * Finds the membership this exact socket connection joined through -
   * unlike markUserOffline, a read with no side effect. The only safe way
   * to answer "what room is this message from": a username alone is
   * ambiguous the moment the same account has more than one live
   * connection (two tabs, or a second tab opened straight on another
   * room's URL) - each keeps its own online membership in a different
   * room, so matching by username alone could resolve to whichever one
   * happens to come first (docs/adr/2026-08-17-room-switching.md).
   */
  findUserBySocketId(socketId: string): Promise<ChatUser | undefined>;
  getUsersInRoom(room: string): Promise<ChatUser[]>;
  /**
   * Atomically claims a room's visibility/access code the first time
   * anyone requests it, and returns whichever config actually won the
   * race across concurrent joiners/nodes - a room's visibility is
   * decided once, at creation, not on every join (docs/adr/2026-08-16-
   * private-rooms.md). Callers pass the config they'd like to create
   * (generating a fresh code for a requested private room is on them,
   * mirroring how SocketController generates message ids); if a config
   * already exists for `config.room`, that existing one is returned
   * instead and the candidate is discarded. `created` tells the caller
   * which of those two happened - see RoomConfigLookup.
   */
  getOrCreateRoomConfig(config: RoomConfig): Promise<RoomConfigLookup>;
};
