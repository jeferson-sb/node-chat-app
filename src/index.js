require('dotenv').config();
const path = require('path');
const http = require('http');
const express = require('express');
const socketio = require('socket.io');
const morgan = require('morgan');
const webpush = require('web-push');

const { generateMessage } = require('./utils/messages');
const {
  addUser,
  removeUser,
  getUser,
  getUsersInRoom
} = require('./utils/users');

const port = process.env.PORT || 8000;
const app = express();
const server = http.createServer(app);
const io = socketio(server);

if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../public')));
  app.get(/.*/, (req, res) => res.sendFile(__dirname + '../public/index.html'));
}

// const publicVapidKey = process.env.PUBLIC_VAPID_KEY;
// const privateVapidKey = process.env.PRIVATE_VAPID_KEY;
// webpush.setVapidDetails(
//   'mailto:test@test.com',
//   publicVapidKey,
//   privateVapidKey
// );

io.on('connection', socket => {
  console.log('New WebSocket connected!');

  // Listen for a join event from the client
  socket.on('join', (options, callback) => {
    const { error, user } = addUser({ id: socket.id, ...options });

    if (error) {
      return callback(error);
    }

    socket.join(user.room);
    socket.emit(
      'message',
      generateMessage('Admin', `Hello ${user.username}, Welcome to the chat!`)
    );
    socket.broadcast
      .to(user.room)
      .emit(
        'message',
        generateMessage('Admin', `${user.username} has joined!`)
      );

    io.to(user.room).emit('roomData', {
      room: user.room,
      users: getUsersInRoom(user.room)
    });
    callback();
  });

  // Listen for a sendMessage event from the client
  socket.on('sendMessage', (message, callback) => {
    const user = getUser(socket.id);
    io.to(user.room).emit('message', generateMessage(user.username, message));
    callback();
  });

  socket.on('disconnect', () => {
    const user = removeUser(socket.id);
    if (user) {
      io.to(user.room).emit(
        'message',
        generateMessage('Admin', `${user.username} has left!`)
      );
      io.to(user.room).emit('roomData', {
        room: user.room,
        users: getUsersInRoom(user.room)
      });
    }
  });
});

app.use((req, res, next) => {
  res.redirect('/');
});

server.listen(
  port,
  console.log(
    `Server running in ${process.env.NODE_ENV} open http://localhost:${port}`
  )
);
