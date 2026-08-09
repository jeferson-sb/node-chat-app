import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server, Socket } from 'socket.io';
import SocketController from './SocketController.ts';
import { eventTypes } from '../../utils/eventTypes.ts';

/**
 * Builds a minimal mock of the subset of socket.io's `Socket` and `Server`
 * APIs that `SocketController` actually calls (`.id`, `.join`, `.emit`,
 * `.to(room).emit`), rather than spinning up a real socket.io server. This
 * keeps these tests fast and focused on the controller's own branching
 * logic; the real wire protocol is covered separately by an integration
 * test exercising the full join/send/disconnect flow.
 */
const createMockRoomEmitter = () => ({ emit: vi.fn() });

const createMockSocket = (id: string): Socket & { id: string } => {
  const roomEmitter = createMockRoomEmitter();
  return {
    id,
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

describe('SocketController', () => {
  let socketServer: Server;
  let controller: SocketController;

  beforeEach(() => {
    socketServer = createMockServer();
    controller = new SocketController({ socketServer });
  });

  describe('onJoinRoom', () => {
    it('joins the socket to the room and welcomes the user', () => {
      const socket = createMockSocket('socket-1');

      controller.onJoinRoom(socket, { username: 'alice', room: 'general' });

      expect(socket.join).toHaveBeenCalledWith('general');
      expect(socket.emit).toHaveBeenCalledWith(
        eventTypes.message,
        expect.objectContaining({
          username: 'Admin',
          text: expect.stringContaining('alice'),
        }),
      );
    });

    it('broadcasts a join message to the rest of the room', () => {
      const socket = createMockSocket('socket-1');

      controller.onJoinRoom(socket, { username: 'alice', room: 'general' });

      const roomEmitter = socket.to('general');
      expect(roomEmitter.emit).toHaveBeenCalledWith(
        eventTypes.message,
        expect.objectContaining({
          username: 'Server',
          text: 'alice has joined the chat!',
        }),
      );
    });

    it('broadcasts updated roomData to the whole room', () => {
      const socket = createMockSocket('socket-1');

      controller.onJoinRoom(socket, { username: 'alice', room: 'general' });

      expect(socketServer.to).toHaveBeenCalledWith('general');
      const roomEmitter = socketServer.to('general');
      expect(roomEmitter.emit).toHaveBeenCalledWith(
        eventTypes.roomData,
        expect.objectContaining({
          room: 'general',
          users: [{ username: 'alice', room: 'general', socketId: 'socket-1' }],
        }),
      );
    });

    it('tracks multiple users joining the same room', () => {
      const alice = createMockSocket('socket-1');
      const bob = createMockSocket('socket-2');

      controller.onJoinRoom(alice, { username: 'alice', room: 'general' });
      controller.onJoinRoom(bob, { username: 'bob', room: 'general' });

      expect(controller.getUsersOnRoom('general')).toHaveLength(2);
    });
  });

  describe('onSendMessage', () => {
    it('broadcasts the message to the sender room only', () => {
      const socket = createMockSocket('socket-1');
      controller.onJoinRoom(socket, { username: 'alice', room: 'general' });
      vi.mocked(socketServer.to).mockClear();

      controller.onSendMessage(socket, {
        username: 'alice',
        message: 'hello everyone',
      });

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

    it('does nothing when the sender is not a known user', () => {
      const socket = createMockSocket('socket-1');

      controller.onSendMessage(socket, {
        username: 'ghost',
        message: 'hello?',
      });

      expect(socketServer.to).not.toHaveBeenCalled();
    });
  });

  describe('onDisconnect', () => {
    it('removes the user and broadcasts they left', () => {
      const socket = createMockSocket('socket-1');
      controller.onJoinRoom(socket, { username: 'alice', room: 'general' });
      vi.mocked(socketServer.to).mockClear();

      controller.onDisconnect(socket);

      expect(controller.getUsersOnRoom('general')).toHaveLength(0);
      const roomEmitter = socket.to('general');
      expect(roomEmitter.emit).toHaveBeenCalledWith(
        eventTypes.message,
        expect.objectContaining({
          username: 'Server',
          text: 'alice has left the chat!',
        }),
      );
    });

    it('does nothing when the socket has no known user', () => {
      const socket = createMockSocket('socket-1');

      controller.onDisconnect(socket);

      expect(socketServer.to).not.toHaveBeenCalled();
    });
  });

  describe('getUsersOnRoom', () => {
    it('returns only users belonging to the given room', () => {
      const alice = createMockSocket('socket-1');
      const bob = createMockSocket('socket-2');
      controller.onJoinRoom(alice, { username: 'alice', room: 'general' });
      controller.onJoinRoom(bob, { username: 'bob', room: 'random' });

      expect(controller.getUsersOnRoom('general')).toEqual([
        { username: 'alice', room: 'general', socketId: 'socket-1' },
      ]);
    });
  });
});
