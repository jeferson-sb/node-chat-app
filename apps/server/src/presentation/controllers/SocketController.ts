import type { Server, Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';

import { Message } from '../../domain/Message.ts';
import { eventTypes } from '../../utils/eventTypes.ts';

export type ChatUser = {
  username: string;
  room: string;
  socketId: string;
};

export type JoinRoomPayload = {
  username: string;
  room: string;
};

export type SendMessagePayload = {
  username: string;
  message: string;
};

export type SocketControllerDeps = {
  socketServer: Server;
};

export default class SocketController {
  private readonly socketServer: Server;
  private readonly users: Map<string, ChatUser>;
  private readonly rooms: Set<string>;

  constructor({ socketServer }: SocketControllerDeps) {
    this.socketServer = socketServer;
    this.users = new Map();
    this.rooms = new Set();
  }

  onJoinRoom(socket: Socket, { username, room }: JoinRoomPayload): void {
    const existingUser = this.users.has(username);

    if (!username && !room) {
      console.error('Username and room are required');
    }

    if (existingUser) {
      console.error('Username already in use!');
    }

    this.users.set(String(username), { username, room, socketId: socket.id });
    this.rooms.add(room);

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

    socket.join(room);
    socket.emit(eventTypes.message, welcomeMessage.snapshot());
    socket.to(room).emit(eventTypes.message, joinMessage.snapshot());

    this.socketServer.to(room).emit(eventTypes.roomData, {
      room,
      users: this.getUsersOnRoom(room),
    });
  }

  onSendMessage(socket: Socket, { username, message }: SendMessagePayload): void {
    const user = this.users.get(username);
    const msg = Message.from({
      id: uuidv4(),
      username,
      text: message,
      createdAt: Date.now(),
    });

    if (user) {
      this.socketServer.to(user.room).emit(eventTypes.message, msg.snapshot());
    }
  }

  onDisconnect(socket: Socket): void {
    const user = [...this.users.values()].find(
      ({ socketId }) => socketId === socket.id,
    );

    if (user) {
      this.users.delete(user.username);

      const disconnectMsg = Message.from({
        id: uuidv4(),
        username: 'Server',
        text: `${user.username} has left the chat!`,
        createdAt: Date.now(),
      });

      socket.to(user.room).emit(eventTypes.message, disconnectMsg.snapshot());
      this.socketServer.to(user.room).emit(eventTypes.roomData, {
        room: user.room,
        users: this.getUsersOnRoom(user.room),
      });
    }

    console.log(`[socket]: disconnected: ${socket.id}`);
  }

  onConnectionError(id: unknown): void {
    console.error(id);
  }

  getUsersOnRoom(room: string): ChatUser[] {
    return [...this.users.values()].filter(({ room: r }) => r === room);
  }
}
