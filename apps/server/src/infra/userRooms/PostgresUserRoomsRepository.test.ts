import { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { PostgresUserRoomsRepository } from './PostgresUserRoomsRepository.ts';
import { migrateUserRooms } from './migrate.ts';

/**
 * Real SQL against an in-process pglite instance rather than a mocked
 * query method, same precedent as auth.integration.test.ts - this
 * exercises the actual upsert/ordering logic, not a re-implementation of
 * it in a fake.
 */
describe('PostgresUserRoomsRepository', () => {
  let db: PGlite;
  let repository: PostgresUserRoomsRepository;

  beforeEach(async () => {
    db = new PGlite();
    await migrateUserRooms(db);
    repository = new PostgresUserRoomsRepository(db);
  });

  it('lists a room right after it is recorded', async () => {
    await repository.recordJoin({
      userId: 'user-1',
      room: 'general-abc123',
      displayName: 'General',
      joinedAt: 1,
    });

    expect(await repository.listJoinedRooms('user-1')).toEqual([
      { room: 'general-abc123', displayName: 'General', lastJoinedAt: 1 },
    ]);
  });

  it('orders rooms by when each was first joined, oldest first', async () => {
    await repository.recordJoin({
      userId: 'user-1',
      room: 'general-abc123',
      displayName: 'General',
      joinedAt: 1,
    });
    await repository.recordJoin({
      userId: 'user-1',
      room: 'random-def456',
      displayName: 'Random',
      joinedAt: 2,
    });

    const rooms = await repository.listJoinedRooms('user-1');

    expect(rooms.map((room) => room.room)).toEqual([
      'general-abc123',
      'random-def456',
    ]);
  });

  it('keeps a room in its original position when joined again later', async () => {
    await repository.recordJoin({
      userId: 'user-1',
      room: 'general-abc123',
      displayName: 'General',
      joinedAt: 1,
    });
    await repository.recordJoin({
      userId: 'user-1',
      room: 'random-def456',
      displayName: 'Random',
      joinedAt: 2,
    });

    await repository.recordJoin({
      userId: 'user-1',
      room: 'general-abc123',
      displayName: 'General',
      joinedAt: 3,
    });

    const rooms = await repository.listJoinedRooms('user-1');

    expect(rooms.map((room) => room.room)).toEqual([
      'general-abc123',
      'random-def456',
    ]);
    expect(rooms[0]).toEqual({
      room: 'general-abc123',
      displayName: 'General',
      lastJoinedAt: 3,
    });
  });

  it('only lists rooms joined by the given user', async () => {
    await repository.recordJoin({
      userId: 'user-1',
      room: 'general-abc123',
      displayName: 'General',
      joinedAt: 1,
    });
    await repository.recordJoin({
      userId: 'user-2',
      room: 'random-def456',
      displayName: 'Random',
      joinedAt: 1,
    });

    expect(await repository.listJoinedRooms('user-1')).toEqual([
      { room: 'general-abc123', displayName: 'General', lastJoinedAt: 1 },
    ]);
  });
});
