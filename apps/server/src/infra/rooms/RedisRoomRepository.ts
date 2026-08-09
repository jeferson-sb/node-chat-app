import type { Redis } from 'ioredis';
import type { ChatUser } from '../../domain/ChatUser.ts';
import type { RoomRepository } from './RoomRepository.ts';

const USERS_KEY = 'chatme:users';

/**
 * Redis-backed room roster, shared by every server node behind a load
 * balancer (see setupSocketServer and docker-compose.yml). Keeps a single
 * hash of socketId -> ChatUser JSON, mirroring InMemoryRoomRepository's
 * Map so behavior (including the O(n) scans in findUserByUsername/
 * getUsersInRoom) stays identical between the two — this app's room
 * sizes don't warrant a per-room index.
 */
export class RedisRoomRepository implements RoomRepository {
  private readonly redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  async addUser(user: ChatUser): Promise<void> {
    await this.redis.hset(USERS_KEY, user.socketId, JSON.stringify(user));
  }

  async removeUser(socketId: string): Promise<ChatUser | undefined> {
    const raw = await this.redis.hget(USERS_KEY, socketId);
    await this.redis.hdel(USERS_KEY, socketId);
    return raw ? (JSON.parse(raw) as ChatUser) : undefined;
  }

  async findUserByUsername(username: string): Promise<ChatUser | undefined> {
    const users = await this.getAllUsers();
    return users.find((user) => user.username === username);
  }

  async getUsersInRoom(room: string): Promise<ChatUser[]> {
    const users = await this.getAllUsers();
    return users.filter((user) => user.room === room);
  }

  private async getAllUsers(): Promise<ChatUser[]> {
    const entries = await this.redis.hgetall(USERS_KEY);
    return Object.values(entries).map((raw) => JSON.parse(raw) as ChatUser);
  }
}
