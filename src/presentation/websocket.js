import { Server as WebSocketServer } from 'socket.io';
import config from '../config/index.js';

export function setupSocketServer(server) {
  const io = new WebSocketServer(server, {
    cors: {
      origin: config.mode === 'production' ? config.client : '*',
      methods: ['GET', 'POST'],
    },
  });
  return io;
}
