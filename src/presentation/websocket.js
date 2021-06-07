const { Server: WebSocketServer } = require('socket.io');

function setupSocketServer(server) {
  const io = new WebSocketServer(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });
  return io;
}

module.exports = { setupSocketServer };
