import { describe, expect, it } from 'vitest';
import { InMemoryRoomRepository } from './InMemoryRoomRepository.ts';

describe('InMemoryRoomRepository', () => {
  describe('getOrCreateRoomConfig', () => {
    it('persists a public room config on its first request', async () => {
      const rooms = new InMemoryRoomRepository();

      const result = await rooms.getOrCreateRoomConfig({
        room: 'general',
        visibility: 'public',
      });

      expect(result).toEqual({
        config: { room: 'general', visibility: 'public' },
        created: true,
      });
    });

    it('persists a private room config together with its access code', async () => {
      const rooms = new InMemoryRoomRepository();

      const result = await rooms.getOrCreateRoomConfig({
        room: 'secret',
        visibility: 'private',
        code: '123456',
      });

      expect(result).toEqual({
        config: { room: 'secret', visibility: 'private', code: '123456' },
        created: true,
      });
    });

    it('returns the same config, flagged as not-created, on every later request', async () => {
      const rooms = new InMemoryRoomRepository();
      await rooms.getOrCreateRoomConfig({
        room: 'secret',
        visibility: 'private',
        code: '123456',
      });

      const result = await rooms.getOrCreateRoomConfig({
        room: 'secret',
        visibility: 'private',
        code: '123456',
      });

      expect(result).toEqual({
        config: { room: 'secret', visibility: 'private', code: '123456' },
        created: false,
      });
    });

    it('ignores a later request that tries to change an already-created room visibility', async () => {
      const rooms = new InMemoryRoomRepository();
      await rooms.getOrCreateRoomConfig({
        room: 'general',
        visibility: 'public',
      });

      const result = await rooms.getOrCreateRoomConfig({
        room: 'general',
        visibility: 'private',
        code: '999999',
      });

      expect(result).toEqual({
        config: { room: 'general', visibility: 'public' },
        created: false,
      });
    });

    it('keeps config for different rooms independent', async () => {
      const rooms = new InMemoryRoomRepository();
      await rooms.getOrCreateRoomConfig({
        room: 'general',
        visibility: 'public',
      });
      await rooms.getOrCreateRoomConfig({
        room: 'secret',
        visibility: 'private',
        code: '123456',
      });

      expect(
        await rooms.getOrCreateRoomConfig({
          room: 'general',
          visibility: 'public',
        }),
      ).toEqual({
        config: { room: 'general', visibility: 'public' },
        created: false,
      });
      expect(
        await rooms.getOrCreateRoomConfig({
          room: 'secret',
          visibility: 'private',
        }),
      ).toEqual({
        config: { room: 'secret', visibility: 'private', code: '123456' },
        created: false,
      });
    });
  });
});
