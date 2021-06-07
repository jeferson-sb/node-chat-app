const express = require('express');
const morgan = require('morgan');
const http = require('http');
const path = require('path');

const { setupSocketServer } = require('./websocket');
const { port, mode } = require('../config');
const HTTPError = require('../infra/errors/HTTPError');

// TODO: Extract to use case
const SocketController = require('./controllers/SocketController');

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

if (mode === 'development') {
  app.use(morgan('dev'));
}

if (mode === 'production') {
  app.use(express.static(path.resolve(__dirname, '..', 'plubic')));
}

app.use((err, req, res, next) => {
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

httpServer.listen(port, () => {
  console.log(`⬆️ Server is up and running on port ${port}`);
});
