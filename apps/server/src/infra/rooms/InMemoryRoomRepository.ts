import type { ChatUser } from '../../domain/ChatUser.ts';
import type { RoomConfig, RoomConfigLookup } from '../../domain/Room.ts';
import type { RoomRepository } from './RoomRepository.ts';

const membershipKey = (room: string, username: string): string =>
  `${room}:${username}`;

export class InMemoryRoomRepository implements RoomRepository {
  private readonly membersByKey: Map<string, ChatUser> = new Map();
  // Resolves a live socketId back to its membership key for
  // markUserOffline, since disconnect only gives us the socketId.
  private readonly keyBySocketId: Map<string, string> = new Map();
  private readonly configByRoom: Map<string, RoomConfig> = new Map();

  async addUser(user: ChatUser): Promise<boolean> {
    const key = membershipKey(user.room, user.username);
    const isFirstJoin = !this.membersByKey.has(key);

    this.membersByKey.set(key, { ...user, online: true });
    this.keyBySocketId.set(user.socketId, key);

    return isFirstJoin;
  }

  async markUserOffline(socketId: string): Promise<ChatUser | undefined> {
    const key = this.keyBySocketId.get(socketId);
    if (!key) return undefined;

    const member = this.membersByKey.get(key);
    if (!member) return undefined;

    const offlineMember: ChatUser = { ...member, online: false };
    this.membersByKey.set(key, offlineMember);
    this.keyBySocketId.delete(socketId);

    return offlineMember;
  }

  async findUserByUsername(username: string): Promise<ChatUser | undefined> {
    return [...this.membersByKey.values()].find(
      (user) => user.username === username && user.online,
    );
  }

  async getUsersInRoom(room: string): Promise<ChatUser[]> {
    return [...this.membersByKey.values()].filter((user) => user.room === room);
  }

  async getOrCreateRoomConfig(config: RoomConfig): Promise<RoomConfigLookup> {
    const existing = this.configByRoom.get(config.room);
    if (existing) return { config: existing, created: false };

    this.configByRoom.set(config.room, config);
    return { config, created: true };
  }
}
