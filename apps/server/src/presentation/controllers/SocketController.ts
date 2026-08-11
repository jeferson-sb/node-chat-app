import type { Server, Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';

import type { ChatUser } from '../../domain/ChatUser.ts';
import { Message } from '../../domain/Message.ts';
import { eventTypes } from '../../utils/eventTypes.ts';
import type { RoomRepository } from '../../infra/rooms/RoomRepository.ts';
import type { MessageHistoryRepository } from '../../infra/history/MessageHistoryRepository.ts';
import { getSocketUser } from '../socketAuth.ts';

export type { ChatUser };

export type JoinRoomPayload = {
  room: string;
};

export type SendMessagePayload = {
  message: string;
};

export type SocketControllerDeps = {
  socketServer: Server;
  rooms: RoomRepository;
  messageHistory: MessageHistoryRepository;
};

/** How many past messages a joining user sees (docs/adr/2026-08-11-chat-history-storage.md). */
const HISTORY_LIMIT = 50;

export default class SocketController {
  private readonly socketServer: Server;
  private readonly rooms: RoomRepository;
  private readonly messageHistory: MessageHistoryRepository;

  constructor({ socketServer, rooms, messageHistory }: SocketControllerDeps) {
    this.socketServer = socketServer;
    this.rooms = rooms;
    this.messageHistory = messageHistory;
  }

  async onJoinRoom(socket: Socket, { room }: JoinRoomPayload): Promise<void> {
    if (!room) {
      console.error('Room is required');
    }

    // No "username already in use" check here: the username now comes
    // from a verified account (socketAuth.ts), not client input, so the
    // account itself - not this check - is what makes it unique (see
    // docs/adr/2026-08-09-authentication.md).
    const { name: username } = getSocketUser(socket);
    await this.rooms.addUser({ username, room, socketId: socket.id });

    socket.join(room);

    const history = await this.messageHistory.getRecentMessages(
      room,
      HISTORY_LIMIT,
    );
    socket.emit(eventTypes.history, history.slice().reverse());

    const welcomeMessage = Message.from({
      id: uuidv4(),
      username: 'Admin',
      text: `Hello ${username}, Welcome to the chat!`,
      createdAt: Date.now(),
    });

    const joinMessage = Message.from({
      id: uuidv4(),
      username: 'Server',
      text: `${username} has joined the chat!`,
      createdAt: Date.now(),
    });

    socket.emit(eventTypes.message, welcomeMessage.snapshot());
    socket.to(room).emit(eventTypes.message, joinMessage.snapshot());

    this.socketServer.to(room).emit(eventTypes.roomData, {
      room,
      users: await this.getUsersOnRoom(room),
    });
  }

  async onSendMessage(
    socket: Socket,
    { message }: SendMessagePayload,
  ): Promise<void> {
    const { name: username } = getSocketUser(socket);
    const user = await this.rooms.findUserByUsername(username);
    const msg = Message.from({
      id: uuidv4(),
      username,
      text: message,
      createdAt: Date.now(),
    });

    if (user) {
      await this.messageHistory.saveMessage(user.room, msg.snapshot());
      this.socketServer.to(user.room).emit(eventTypes.message, msg.snapshot());
    }
  }

  async onDisconnect(socket: Socket): Promise<void> {
    const user = await this.rooms.removeUser(socket.id);

    if (user) {
      const disconnectMsg = Message.from({
        id: uuidv4(),
        username: 'Server',
        text: `${user.username} has left the chat!`,
        createdAt: Date.now(),
      });

      socket.to(user.room).emit(eventTypes.message, disconnectMsg.snapshot());
      this.socketServer.to(user.room).emit(eventTypes.roomData, {
        room: user.room,
        users: await this.getUsersOnRoom(user.room),
      });
    }

    console.log(`[socket]: disconnected: ${socket.id}`);
  }

  onConnectionError(id: unknown): void {
    console.error(id);
  }

  getUsersOnRoom(room: string): Promise<ChatUser[]> {
    return this.rooms.getUsersInRoom(room);
  }
}
