import type { Redis } from 'ioredis';
import type { ChatUser } from '../../domain/ChatUser.ts';
import type { RoomConfig, RoomConfigLookup } from '../../domain/Room.ts';
import type { RoomRepository } from './RoomRepository.ts';

const MEMBERS_KEY = 'chatme:members';
const SOCKET_INDEX_KEY = 'chatme:socket-index';
const ROOM_CONFIG_KEY = 'chatme:room-config';

const membershipKey = (room: string, username: string): string =>
  `${room}:${username}`;

/**
 * Redis-backed room roster, shared by every server node behind a load
 * balancer (see setupSocketServer and docker-compose.yml). Keeps a hash
 * of "room:username" -> ChatUser JSON (membership, survives disconnects)
 * plus a second hash of socketId -> "room:username", resolving
 * markUserOffline/findUserBySocketId in O(1) since a disconnect or a sent
 * message only ever hands us the socketId. getUsersInRoom still does an
 * O(n) hgetall scan - fine at this app's scale, see
 * docs/adr/2026-08-09-horizontal-scaling.md.
 * See docs/adr/2026-08-12-presence-indicators.md for why membership is
 * keyed by (room, username) rather than socketId.
 *
 * A third hash (chatme:room-config: room -> RoomConfig JSON) holds each
 * room's visibility/access code, set once via HSETNX so concurrent first
 * joiners across nodes agree on a single winner instead of one
 * overwriting another's choice (docs/adr/2026-08-16-private-rooms.md).
 * Manually verified against a running Redis instance rather than covered
 * by an automated test, same precedent as this class's other methods
 * (see docs/adr/2026-08-09-horizontal-scaling.md and
 * RedisReadCursorRepository).
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

  async findUserBySocketId(socketId: string): Promise<ChatUser | undefined> {
    const key = await this.redis.hget(SOCKET_INDEX_KEY, socketId);
    if (!key) return undefined;

    const raw = await this.redis.hget(MEMBERS_KEY, key);
    return raw ? (JSON.parse(raw) as ChatUser) : undefined;
  }

  async getUsersInRoom(room: string): Promise<ChatUser[]> {
    const users = await this.getAllMembers();
    return users.filter((user) => user.room === room);
  }

  private async getAllMembers(): Promise<ChatUser[]> {
    const entries = await this.redis.hgetall(MEMBERS_KEY);
    return Object.values(entries).map((raw) => JSON.parse(raw) as ChatUser);
  }

  async getOrCreateRoomConfig(config: RoomConfig): Promise<RoomConfigLookup> {
    const wasSet = await this.redis.hsetnx(
      ROOM_CONFIG_KEY,
      config.room,
      JSON.stringify(config),
    );
    if (wasSet === 1) return { config, created: true };

    // wasSet === 0 means the field already existed, so this hget can't
    // come back empty - a different join (this node or another) won the
    // race and its config is what every joiner must agree on.
    const raw = await this.redis.hget(ROOM_CONFIG_KEY, config.room);
    return { config: JSON.parse(raw as string) as RoomConfig, created: false };
  }
}
