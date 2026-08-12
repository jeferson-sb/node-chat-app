import type { Redis } from 'ioredis';
import type { ChatUser } from '../../domain/ChatUser.ts';
import type { RoomRepository } from './RoomRepository.ts';

const MEMBERS_KEY = 'chatme:members';
const SOCKET_INDEX_KEY = 'chatme:socket-index';

const membershipKey = (room: string, username: string): string =>
  `${room}:${username}`;

/**
 * Redis-backed room roster, shared by every server node behind a load
 * balancer (see setupSocketServer and docker-compose.yml). Keeps a hash
 * of "room:username" -> ChatUser JSON (membership, survives disconnects)
 * plus a second hash of socketId -> "room:username" purely to resolve
 * markUserOffline, since a disconnect only hands us the socketId. Same
 * O(n) hgetall scans in findUserByUsername/getUsersInRoom as before -
 * fine at this app's scale, see docs/adr/2026-08-09-horizontal-scaling.md.
 * See docs/adr/2026-08-12-presence-indicators.md for why membership is
 * keyed by (room, username) rather than socketId.
 */
export class RedisRoomRepository implements RoomRepository {
  private readonly redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  async addUser(user: ChatUser): Promise<boolean> {
    const key = membershipKey(user.room, user.username);
    const isFirstJoin = (await this.redis.hexists(MEMBERS_KEY, key)) === 0;

    const member: ChatUser = { ...user, online: true };
    await this.redis.hset(MEMBERS_KEY, key, JSON.stringify(member));
    await this.redis.hset(SOCKET_INDEX_KEY, user.socketId, key);

    return isFirstJoin;
  }

  async markUserOffline(socketId: string): Promise<ChatUser | undefined> {
    const key = await this.redis.hget(SOCKET_INDEX_KEY, socketId);
    if (!key) return undefined;

    const raw = await this.redis.hget(MEMBERS_KEY, key);
    if (!raw) return undefined;

    const offlineMember: ChatUser = { ...JSON.parse(raw), online: false };
    await this.redis.hset(MEMBERS_KEY, key, JSON.stringify(offlineMember));
    await this.redis.hdel(SOCKET_INDEX_KEY, socketId);

    return offlineMember;
  }

  async findUserByUsername(username: string): Promise<ChatUser | undefined> {
    const users = await this.getAllMembers();
    return users.find((user) => user.username === username && user.online);
  }

  async getUsersInRoom(room: string): Promise<ChatUser[]> {
    const users = await this.getAllMembers();
    return users.filter((user) => user.room === room);
  }

  private async getAllMembers(): Promise<ChatUser[]> {
    const entries = await this.redis.hgetall(MEMBERS_KEY);
    return Object.values(entries).map((raw) => JSON.parse(raw) as ChatUser);
  }
}
