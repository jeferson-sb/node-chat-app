import type { ChatUser } from '../../domain/ChatUser.ts';

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
  /** Matches only online members - see the module doc comment. */
  findUserByUsername(username: string): Promise<ChatUser | undefined>;
  getUsersInRoom(room: string): Promise<ChatUser[]>;
};
