import { describe, expect, it, vi } from 'vitest';

const configMock = vi.hoisted(() => ({
  redisUrl: undefined as string | undefined,
  databaseUrl: undefined as string | undefined,
  scyllaContactPoints: undefined as string[] | undefined,
  scyllaLocalDataCenter: 'datacenter1',
}));

vi.mock('./config/index.ts', () => ({ default: configMock }));

const { bootstrap } = await import('./bootstrap.ts');
const { InMemoryRoomRepository } =
  await import('./infra/rooms/InMemoryRoomRepository.ts');
const { InMemoryMessageHistoryRepository } =
  await import('./infra/history/InMemoryMessageHistoryRepository.ts');
const { InMemoryMessageQueue } =
  await import('./infra/queue/InMemoryMessageQueue.ts');

/**
 * Map-backed fake, not a shared production class - see
 * SocketController.test.ts's createFakeUserRooms for the same
 * reasoning. Only bootstrap()'s own wiring is under test here, not
 * UserRoomsRepository's behavior (covered by
 * PostgresUserRoomsRepository.test.ts).
 */
const fakeUserRooms = {
  recordJoin: async () => {},
  listJoinedRooms: async () => [],
};

describe('bootstrap', () => {
  it('falls back to in-memory services when no external stores are configured', () => {
    configMock.redisUrl = undefined;
    configMock.databaseUrl = undefined;
    configMock.scyllaContactPoints = undefined;

    const services = bootstrap({
      authDatabase: {} as never,
      userRooms: fakeUserRooms,
    });

    expect(services.rooms).toBeInstanceOf(InMemoryRoomRepository);
    expect(services.messageHistory).toBeInstanceOf(
      InMemoryMessageHistoryRepository,
    );
    expect(services.messageQueue).toBeInstanceOf(InMemoryMessageQueue);
    expect(services.adapter).toBeUndefined();
  });

  it('throws when no authDatabase override and DATABASE_URL is unset', () => {
    configMock.databaseUrl = undefined;

    expect(() => bootstrap()).toThrow(
      'DATABASE_URL is required to start the server',
    );
  });

  it('uses each overridden service as-is instead of resolving a default', async () => {
    const rooms = new InMemoryRoomRepository();
    const messageHistory = new InMemoryMessageHistoryRepository();
    const messageQueue = new InMemoryMessageQueue(messageHistory);
    const authDatabase = {} as never;

    const services = bootstrap({
      rooms,
      messageHistory,
      messageQueue,
      authDatabase,
      userRooms: fakeUserRooms,
    });

    expect(services.rooms).toBe(rooms);
    expect(services.messageHistory).toBe(messageHistory);
    expect(services.messageQueue).toBe(messageQueue);
    expect(services.database).toBe(authDatabase);
    expect(services.userRooms).toBe(fakeUserRooms);

    // Overridden services' lifecycle belongs to the caller - close() must
    // not touch them (nothing to assert against directly here since
    // these are plain in-memory fakes with no close of their own, but
    // this documents the contract close() itself relies on).
    await expect(services.close()).resolves.toBeUndefined();
  });
});
