import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server, Socket } from 'socket.io';
import SocketController from './SocketController.ts';
import { InMemoryRoomRepository } from '../../infra/rooms/InMemoryRoomRepository.ts';
import { InMemoryMessageHistoryRepository } from '../../infra/history/InMemoryMessageHistoryRepository.ts';
import { InMemoryMessageQueue } from '../../infra/queue/InMemoryMessageQueue.ts';
import { eventTypes } from '../../utils/eventTypes.ts';
import { ValidationError } from '../../domain/errors/ValidationError.ts';
import { RoomNotFoundError } from '../../domain/errors/RoomNotFoundError.ts';

/**
 * Builds a minimal mock of the subset of socket.io's `Socket` and `Server`
 * APIs that `SocketController` actually calls (`.id`, `.data.user`,
 * `.join`, `.emit`, `.to(room).emit`), rather than spinning up a real
 * socket.io server. This keeps these tests fast and focused on the
 * controller's own branching logic; the real wire protocol (including the
 * socketAuth.ts middleware that populates `.data.user`) is covered
 * separately by an integration test exercising the full join/send/
 * disconnect flow.
 *
 * The room roster itself uses the real InMemoryRoomRepository rather than
 * a mock, since re-mocking Map-like storage would just duplicate its
 * logic. RedisRoomRepository (used instead when REDIS_URL is set, see
 * createApp.ts) is verified manually against a running docker-compose
 * setup — see docs/adr/2026-08-09-modernize-stack.md.
 */
const createMockRoomEmitter = () => ({ emit: vi.fn() });

const createMockSocket = (
  id: string,
  username: string,
): Socket & { id: string } => {
  const roomEmitter = createMockRoomEmitter();
  return {
    id,
    data: { user: { id: `user-${id}`, name: username } },
    join: vi.fn(),
    emit: vi.fn(),
    to: vi.fn(() => roomEmitter),
  } as unknown as Socket & { id: string };
};

const createMockServer = (): Server => {
  const roomEmitter = createMockRoomEmitter();
  return {
    to: vi.fn(() => roomEmitter),
  } as unknown as Server;
};

/**
 * Map-backed fake, not a shared production class - ReadCursorRepository
 * is deliberately Redis-only in production (see NullReadCursorRepository/
 * docs/adr/2026-08-14-offline-delivery.md), so this test double exists
 * only here rather than as an InMemory implementation the app could
 * accidentally fall back to.
 */
const createFakeReadCursors = () => {
  const cursors = new Map<string, number>();
  const key = (room: string, username: string): string => `${room}:${username}`;
  return {
    getLastSeenAt: vi.fn(async (room: string, username: string) =>
      cursors.get(key(room, username)),
    ),
    markSeen: vi.fn(async (room: string, username: string, seenAt: number) => {
      cursors.set(key(room, username), seenAt);
    }),
  };
};

describe('SocketController', () => {
  let socketServer: Server;
  let messageHistory: InMemoryMessageHistoryRepository;
  let readCursors: ReturnType<typeof createFakeReadCursors>;
  let controller: SocketController;

  beforeEach(() => {
    socketServer = createMockServer();
    messageHistory = new InMemoryMessageHistoryRepository();
    readCursors = createFakeReadCursors();
    controller = new SocketController({
      socketServer,
      rooms: new InMemoryRoomRepository(),
      messageHistory,
      messageQueue: new InMemoryMessageQueue(messageHistory),
      readCursors,
    });
  });

  describe('onJoinRoom', () => {
    it('joins the socket to the room and welcomes the user', async () => {
      const socket = createMockSocket('socket-1', 'alice');

      await controller.onJoinRoom(socket, { room: 'general' });

      expect(socket.join).toHaveBeenCalledWith('general');
      expect(socket.emit).toHaveBeenCalledWith(
        eventTypes.message,
        expect.objectContaining({
          username: 'Admin',
          text: expect.stringContaining('alice'),
        }),
      );
    });

    it('broadcasts a join message to the rest of the room', async () => {
      const socket = createMockSocket('socket-1', 'alice');

      await controller.onJoinRoom(socket, { room: 'general' });

      const roomEmitter = socket.to('general');
      expect(roomEmitter.emit).toHaveBeenCalledWith(
        eventTypes.message,
        expect.objectContaining({
          username: 'Server',
          text: 'alice has joined the chat!',
        }),
      );
    });

    it('broadcasts updated roomData to the whole room', async () => {
      const socket = createMockSocket('socket-1', 'alice');

      await controller.onJoinRoom(socket, { room: 'general' });

      expect(socketServer.to).toHaveBeenCalledWith('general');
      const roomEmitter = socketServer.to('general');
      expect(roomEmitter.emit).toHaveBeenCalledWith(
        eventTypes.roomData,
        expect.objectContaining({
          room: 'general',
          users: [
            {
              username: 'alice',
              room: 'general',
              socketId: 'socket-1',
              online: true,
            },
          ],
        }),
      );
    });

    it('does not broadcast a join message when a returning user rejoins the room', async () => {
      const firstConnection = createMockSocket('socket-1', 'alice');
      await controller.onJoinRoom(firstConnection, { room: 'general' });
      await controller.onDisconnect(firstConnection);

      const secondConnection = createMockSocket('socket-2', 'alice');
      await controller.onJoinRoom(secondConnection, { room: 'general' });

      const roomEmitter = secondConnection.to('general');
      expect(roomEmitter.emit).not.toHaveBeenCalledWith(
        eventTypes.message,
        expect.objectContaining({ text: expect.stringContaining('joined') }),
      );
    });

    it('marks a returning user online again in roomData', async () => {
      const firstConnection = createMockSocket('socket-1', 'alice');
      await controller.onJoinRoom(firstConnection, { room: 'general' });
      await controller.onDisconnect(firstConnection);

      const secondConnection = createMockSocket('socket-2', 'alice');
      await controller.onJoinRoom(secondConnection, { room: 'general' });

      expect(await controller.getUsersOnRoom('general')).toEqual([
        {
          username: 'alice',
          room: 'general',
          socketId: 'socket-2',
          online: true,
        },
      ]);
    });

    it('tracks multiple users joining the same room', async () => {
      const alice = createMockSocket('socket-1', 'alice');
      const bob = createMockSocket('socket-2', 'bob');

      await controller.onJoinRoom(alice, { room: 'general' });
      await controller.onJoinRoom(bob, { room: 'general' });

      expect(await controller.getUsersOnRoom('general')).toHaveLength(2);
    });

    it('emits persisted history to the joining socket, oldest first', async () => {
      await messageHistory.saveMessage('general', {
        id: '1',
        username: 'alice',
        text: 'first',
        createdAt: 1,
      });
      await messageHistory.saveMessage('general', {
        id: '2',
        username: 'alice',
        text: 'second',
        createdAt: 2,
      });
      const socket = createMockSocket('socket-1', 'alice');

      await controller.onJoinRoom(socket, { room: 'general' });

      expect(socket.emit).toHaveBeenCalledWith(eventTypes.history, [
        expect.objectContaining({ text: 'first' }),
        expect.objectContaining({ text: 'second' }),
      ]);
    });

    it('does not persist the synthetic welcome/join messages', async () => {
      const socket = createMockSocket('socket-1', 'alice');

      await controller.onJoinRoom(socket, { room: 'general' });

      expect(await messageHistory.getRecentMessages('general', 10)).toEqual([]);
    });

    it('rejects a missing room with a ValidationError', async () => {
      const socket = createMockSocket('socket-1', 'alice');

      await expect(controller.onJoinRoom(socket, { room: '' })).rejects.toThrow(
        ValidationError,
      );
    });
  });

  describe('onSendMessage', () => {
    it('broadcasts the message to the sender room only', async () => {
      const socket = createMockSocket('socket-1', 'alice');
      await controller.onJoinRoom(socket, { room: 'general' });
      vi.mocked(socketServer.to).mockClear();

      await controller.onSendMessage(socket, { message: 'hello everyone' });

      expect(socketServer.to).toHaveBeenCalledWith('general');
      const roomEmitter = socketServer.to('general');
      expect(roomEmitter.emit).toHaveBeenCalledWith(
        eventTypes.message,
        expect.objectContaining({
          username: 'alice',
          text: 'hello everyone',
        }),
      );
    });

    it('rejects a message from a sender with no active room membership', async () => {
      const socket = createMockSocket('socket-1', 'ghost');

      await expect(
        controller.onSendMessage(socket, { message: 'hello?' }),
      ).rejects.toThrow(RoomNotFoundError);

      expect(socketServer.to).not.toHaveBeenCalled();
    });

    it('persists the message to history', async () => {
      const socket = createMockSocket('socket-1', 'alice');
      await controller.onJoinRoom(socket, { room: 'general' });

      await controller.onSendMessage(socket, { message: 'hello everyone' });

      expect(await messageHistory.getRecentMessages('general', 10)).toEqual([
        expect.objectContaining({
          username: 'alice',
          text: 'hello everyone',
        }),
      ]);
    });

    it('broadcasts the message even when enqueuing it to history fails', async () => {
      const failingController = new SocketController({
        socketServer,
        rooms: new InMemoryRoomRepository(),
        messageHistory,
        messageQueue: {
          enqueue: vi.fn().mockRejectedValue(new Error('queue unavailable')),
        },
        readCursors: createFakeReadCursors(),
      });
      const socket = createMockSocket('socket-1', 'alice');
      await failingController.onJoinRoom(socket, { room: 'general' });
      vi.mocked(socketServer.to).mockClear();

      await expect(
        failingController.onSendMessage(socket, { message: 'hello everyone' }),
      ).rejects.toThrow('queue unavailable');

      expect(socketServer.to).toHaveBeenCalledWith('general');
      const roomEmitter = socketServer.to('general');
      expect(roomEmitter.emit).toHaveBeenCalledWith(
        eventTypes.message,
        expect.objectContaining({ username: 'alice', text: 'hello everyone' }),
      );
    });

    it('rejects a message over the length limit without broadcasting it', async () => {
      const socket = createMockSocket('socket-1', 'alice');
      await controller.onJoinRoom(socket, { room: 'general' });
      vi.mocked(socketServer.to).mockClear();

      await expect(
        controller.onSendMessage(socket, { message: 'a'.repeat(100_001) }),
      ).rejects.toThrow('Message text cannot exceed 100000 characters');

      expect(socketServer.to).not.toHaveBeenCalled();
    });
  });

  describe('onDisconnect', () => {
    it('marks the user offline without a "has left" message', async () => {
      const socket = createMockSocket('socket-1', 'alice');
      await controller.onJoinRoom(socket, { room: 'general' });
      // onDisconnect no longer talks to socket.to(...) at all (it has no
      // "has left" message to send) - only socketServer.to(...) for the
      // roomData refresh, asserted separately below.
      vi.mocked(socket.to).mockClear();

      await controller.onDisconnect(socket);

      expect(await controller.getUsersOnRoom('general')).toEqual([
        {
          username: 'alice',
          room: 'general',
          socketId: 'socket-1',
          online: false,
        },
      ]);
      expect(socket.to).not.toHaveBeenCalled();
    });

    it('broadcasts updated roomData reflecting the offline user', async () => {
      const socket = createMockSocket('socket-1', 'alice');
      await controller.onJoinRoom(socket, { room: 'general' });
      vi.mocked(socketServer.to).mockClear();

      await controller.onDisconnect(socket);

      expect(socketServer.to).toHaveBeenCalledWith('general');
      const roomEmitter = socketServer.to('general');
      expect(roomEmitter.emit).toHaveBeenCalledWith(
        eventTypes.roomData,
        expect.objectContaining({
          room: 'general',
          users: [
            expect.objectContaining({ username: 'alice', online: false }),
          ],
        }),
      );
    });

    it('does nothing when the socket has no known user', async () => {
      const socket = createMockSocket('socket-1', 'alice');

      await controller.onDisconnect(socket);

      expect(socketServer.to).not.toHaveBeenCalled();
    });
  });

  describe('offline delivery', () => {
    it('delivers only messages saved after the cursor on reconnect', async () => {
      await messageHistory.saveMessage('general', {
        id: '1',
        username: 'bob',
        text: 'seen before disconnect',
        createdAt: 100,
      });
      await readCursors.markSeen('general', 'alice', 100);
      await messageHistory.saveMessage('general', {
        id: '2',
        username: 'bob',
        text: 'missed while offline',
        createdAt: 200,
      });
      const socket = createMockSocket('socket-1', 'alice');

      await controller.onJoinRoom(socket, { room: 'general' });

      expect(socket.emit).toHaveBeenCalledWith(eventTypes.history, [
        expect.objectContaining({ text: 'missed while offline' }),
      ]);
    });

    it('advances the cursor to the newest delivered message on join', async () => {
      await messageHistory.saveMessage('general', {
        id: '1',
        username: 'bob',
        text: 'missed',
        createdAt: 150,
      });
      await readCursors.markSeen('general', 'alice', 100);
      const socket = createMockSocket('socket-1', 'alice');

      await controller.onJoinRoom(socket, { room: 'general' });

      expect(await readCursors.getLastSeenAt('general', 'alice')).toBe(150);
    });

    it('does not advance the cursor on join when there is nothing new to deliver', async () => {
      await readCursors.markSeen('general', 'alice', 100);
      const socket = createMockSocket('socket-1', 'alice');

      await controller.onJoinRoom(socket, { room: 'general' });

      expect(await readCursors.getLastSeenAt('general', 'alice')).toBe(100);
    });

    it('advances the cursor at disconnect so live-received messages are not redelivered on the next reconnect', async () => {
      const socket = createMockSocket('socket-1', 'alice');
      await controller.onJoinRoom(socket, { room: 'general' });
      const before = Date.now();

      await controller.onDisconnect(socket);

      const lastSeenAt = await readCursors.getLastSeenAt('general', 'alice');
      expect(lastSeenAt).toBeGreaterThanOrEqual(before);
    });
  });

  describe('getUsersOnRoom', () => {
    it('returns only users belonging to the given room', async () => {
      const alice = createMockSocket('socket-1', 'alice');
      const bob = createMockSocket('socket-2', 'bob');
      await controller.onJoinRoom(alice, { room: 'general' });
      await controller.onJoinRoom(bob, { room: 'random' });

      expect(await controller.getUsersOnRoom('general')).toEqual([
        {
          username: 'alice',
          room: 'general',
          socketId: 'socket-1',
          online: true,
        },
      ]);
    });
  });
});
