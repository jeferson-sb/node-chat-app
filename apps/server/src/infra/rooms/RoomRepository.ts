import type { ChatUser } from '../../domain/ChatUser.ts';

/**
 * Room roster storage, abstracted so SocketController can run against
 * either a single-process in-memory store or a Redis-backed store shared
 * by every server node behind a load balancer. Without a shared store,
 * each node would only know about the users that joined through it,
 * breaking the sidebar user list and username-uniqueness check for any
 * room split across nodes.
 */
export type RoomRepository = {
  addUser(user: ChatUser): Promise<void>;
  removeUser(socketId: string): Promise<ChatUser | undefined>;
  findUserByUsername(username: string): Promise<ChatUser | undefined>;
  getUsersInRoom(room: string): Promise<ChatUser[]>;
};
