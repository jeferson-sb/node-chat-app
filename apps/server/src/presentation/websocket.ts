import type { Server as HTTPServer } from 'node:http';
import type { Adapter } from 'socket.io-adapter';
import { Server as WebSocketServer, type Namespace } from 'socket.io';
import config from '../config/index.ts';

export type SetupSocketServerOptions = {
  /**
   * When running behind a load balancer with more than one server
   * instance, pass a Redis (or other) adapter constructor so
   * `io.to(room).emit(...)` fans out to every node instead of just the
   * one the sender is connected to. See createApp.ts.
   */
  adapter?: (nsp: Namespace) => Adapter;
};

export const setupSocketServer = (
  server: HTTPServer,
  { adapter }: SetupSocketServerOptions = {},
): WebSocketServer => {
  const socketServer = new WebSocketServer(server, {
    cors: {
      origin: config.mode === 'production' ? config.client : '*',
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  if (adapter) {
    socketServer.adapter(adapter);
  }

  return socketServer;
};
