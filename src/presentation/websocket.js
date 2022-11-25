import { Server as WebSocketServer } from 'socket.io';

export function setupSocketServer(server) {
  const io = new WebSocketServer(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });
  return io;
}
