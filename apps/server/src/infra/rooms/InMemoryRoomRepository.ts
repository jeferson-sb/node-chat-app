import type { ChatUser } from '../../domain/ChatUser.ts';
import type { RoomRepository } from './RoomRepository.ts';

/**
 * Single-process room roster, matching SocketController's original
 * in-memory Map/Set. Used when no REDIS_URL is configured (local dev,
 * or a single-node deployment) — see setupSocketServer.
 */
export class InMemoryRoomRepository implements RoomRepository {
  private readonly usersBySocketId: Map<string, ChatUser> = new Map();

  async addUser(user: ChatUser): Promise<void> {
    this.usersBySocketId.set(user.socketId, user);
  }

  async removeUser(socketId: string): Promise<ChatUser | undefined> {
    const user = this.usersBySocketId.get(socketId);
    this.usersBySocketId.delete(socketId);
    return user;
  }

  async findUserByUsername(username: string): Promise<ChatUser | undefined> {
    return [...this.usersBySocketId.values()].find(
      (user) => user.username === username,
    );
  }

  async getUsersInRoom(room: string): Promise<ChatUser[]> {
    return [...this.usersBySocketId.values()].filter(
      (user) => user.room === room,
    );
  }
}
