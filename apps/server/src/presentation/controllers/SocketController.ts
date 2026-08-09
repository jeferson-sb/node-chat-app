import type { Server, Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';

import type { ChatUser } from '../../domain/ChatUser.ts';
import { Message } from '../../domain/Message.ts';
import { eventTypes } from '../../utils/eventTypes.ts';
import type { RoomRepository } from '../../infra/rooms/RoomRepository.ts';

export type { ChatUser };

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
  rooms: RoomRepository;
};

export default class SocketController {
  private readonly socketServer: Server;
  private readonly rooms: RoomRepository;

  constructor({ socketServer, rooms }: SocketControllerDeps) {
    this.socketServer = socketServer;
    this.rooms = rooms;
  }

  async onJoinRoom(
    socket: Socket,
    { username, room }: JoinRoomPayload,
  ): Promise<void> {
    if (!username && !room) {
      console.error('Username and room are required');
    }

    const existingUser = await this.rooms.findUserByUsername(username);
    if (existingUser) {
      console.error('Username already in use!');
    }

    await this.rooms.addUser({ username, room, socketId: socket.id });

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
      users: await this.getUsersOnRoom(room),
    });
  }

  async onSendMessage(
    socket: Socket,
    { username, message }: SendMessagePayload,
  ): Promise<void> {
    const user = await this.rooms.findUserByUsername(username);
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
