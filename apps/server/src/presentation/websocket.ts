import type { Server as HTTPServer } from 'node:http';
import { Server as WebSocketServer } from 'socket.io';
import config from '../config/index.ts';

export const setupSocketServer = (server: HTTPServer): WebSocketServer => {
  return new WebSocketServer(server, {
    cors: {
      origin: config.mode === 'production' ? config.client : '*',
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });
};
