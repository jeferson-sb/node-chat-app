import http from 'node:http';
import express, { type ErrorRequestHandler } from 'express';
import morgan from 'morgan';

import { setupSocketServer } from './websocket.ts';
import config from '../config/index.ts';
import HTTPError from '../infra/errors/HTTPError.ts';

// TODO: Extract to use case
import SocketController, {
  type JoinRoomPayload,
  type SendMessagePayload,
} from './controllers/SocketController.ts';

export type App = {
  app: express.Express;
  httpServer: http.Server;
  controller: SocketController;
};

/**
 * Wires up the Express app, HTTP server, and Socket.io server without
 * starting to listen. Extracted from the server entrypoint so integration
 * tests can bind to an ephemeral port instead of the configured one.
 */
export const createApp = (): App => {
  const app = express();
  const httpServer = http.createServer(app);
  const socketServer = setupSocketServer(httpServer);
  const controller = new SocketController({ socketServer });

  // Add Access Control Allow Origin headers
  app.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', config.client);
    res.header(
      'Access-Control-Allow-Headers',
      'Origin, X-Requested-With, Content-Type, Accept',
    );
    next();
  });

  socketServer.on('connection', (socket) => {
    console.log(`[socket]: new socket connected: ${socket.id}`);

    // Listen to socket events
    socket.on('join', (data: JoinRoomPayload) => {
      controller.onJoinRoom(socket, data);
    });
    socket.on('error', () => controller.onConnectionError(socket));
    socket.on('sendMessage', (data: SendMessagePayload) =>
      controller.onSendMessage(socket, data),
    );
    socket.on('disconnect', () => controller.onDisconnect(socket));
  });

  if (config.mode === 'development') {
    app.use(morgan('dev'));
  }

  const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof HTTPError) {
      res.status(err.statusCode).json({
        status: 'error',
        message: err.message,
      });
      return;
    }

    res.status(500).json({ message: 'Internal Server Error', status: 'error' });
  };

  app.use(errorHandler);

  return { app, httpServer, controller };
};
