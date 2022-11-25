import express from 'express';
import morgan from 'morgan';
import http from 'http';
import path from 'path';

import { setupSocketServer } from './websocket.js';
import config from '../config/index.js';
import HTTPError from '../infra/errors/HTTPError.js';

// TODO: Extract to use case
import SocketController from './controllers/SocketController.js';

const app = express();
const httpServer = http.createServer(app);
const socketServer = setupSocketServer(httpServer);
const controller = new SocketController({ socketServer });

socketServer.on('connection', (socket) => {
  console.log(`[socket]: new socket connected: ${socket.id}`);

  // Listen to socket events
  socket.on('join', (data) => {
    controller.onJoinRoom(socket, data);
  });
  socket.on('error', () => controller.onConnectionError(socket));
  socket.on('sendMessage', (data) => controller.onSendMessage(socket, data));
  socket.on('disconnect', () => controller.onDisconnect(socket));
});

if (config.mode === 'development') {
  app.use(morgan('dev'));
}

if (config.mode === 'production') {
  app.use(express.static(path.resolve(__dirname, '..', 'plubic')));
}

app.use((err, _req, res, _next) => {
  if (err instanceof HTTPError) {
    return res.status(err.statusCode).json({
      status: 'error',
      message: err.message,
    });
  }

  return res
    .status(500)
    .json({ message: 'Internal Server Error', status: 'error' });
});

httpServer.listen(config.port, () => {
  console.log(`⬆️ Server is up and running on port ${config.port}`);
});
