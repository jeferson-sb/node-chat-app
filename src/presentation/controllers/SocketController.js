import { v4 as uuidv4 } from 'uuid';

import { Message } from '../../domain/Message.js';
import { eventTypes } from '../../utils/eventTypes.js';

export default class SocketController {
  constructor({ socketServer }) {
    this.socketServer = socketServer;
    this.users = new Map();
    this.rooms = new Set();
  }

  onJoinRoom(socket, { username, room }) {
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

  onSendMessage(socket, { username, message }) {
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

  onDisconnect(socket) {
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

  onConnectionError(id) {
    console.error(id);
  }

  getUsersOnRoom(room) {
    const activeUsers = [...this.users.values()].filter(
      ({ room: r }) => r === room,
    );

    return activeUsers || [];
  }
}
