<template>
  <main class="chat">
    <aside id="sidebar" class="chat__sidebar">
      <h2 class="room-title">{{room}}</h2>
      <h3 class="list-title">Users</h3>
      <ul class="users">
        <li v-for="user in users" :key="user.id">{{ user.username }}</li>
      </ul>
    </aside>
    <div class="chat__main">
      <div id="messages" class="chat__messages" v-chat-scroll="{always: false, smooth: true}">
        <div
          v-for="message in messages"
          :key="message.id"
          :class="['message', message.username === username ? 'message--sent' : '']"
        >
          <p>
            <span
              class="message__name"
              v-show="message.username !== username"
            >{{ message.username }}</span>
            <time
              class="message__meta"
              datetime="message.createdAt"
            >{{ message.createdAt | formatDatetime }}</time>
          </p>
          <p>{{ message.text }}</p>
        </div>
      </div>

      <div class="compose">
        <form id="message-form" @submit.prevent="sendMessage">
          <input
            name="message"
            v-model="message"
            placeholder="Type your message ..."
            required
            autocomplete="off"
          />
          <button type="submit">Send</button>
        </form>
      </div>
    </div>
  </main>
</template>

<script>
import io from 'socket.io-client'

export default {
  name: 'Chat',
  data() {
    return {
      users: {},
      username: '',
      createdAt: '',
      message: '',
      messages: [],
      room: ''
    }
  },
  async created() {
    const { username, room } = this.$route.params
    this.username = username
    this.room = room
    if (process.env.NODE_ENV === 'production') {
      this.socket = io('https://serene-hamlet-35525.herokuapp.com/')
    } else {
      this.socket = io('http://localhost:5000/')
    }
  },
  mounted() {
    const user = {
      username: this.username,
      room: this.room
    }

    this.socket.emit('join', user, error => {
      if (error) {
        throw new Error(error)
      }
    })
    this.socket.on('message', msg => {
      this.messages.push(msg)
    })

    this.socket.on('roomData', ({ users }) => {
      this.users = users
    })
  },
  methods: {
    sendMessage() {
      this.socket.emit('sendMessage', this.message, error => {
        if (error) {
          throw new Error(error)
        }
        this.message = ''
      })
    }
  },
  filters: {
    formatDatetime(value) {
      const createdAt = new Date(value)
      return createdAt.toLocaleString()
    }
  }
}
</script>

<style scoped>
.chat {
  display: flex;
}

.chat__sidebar {
  height: 100vh;
  color: var(--white);
  background: var(--bg-color);
  width: 225px;
}

/* Chat styles */

.chat__main {
  flex-grow: 1;
  display: flex;
  flex-direction: column;
  max-height: 100vh;
  background-color: var(--dark-2);
  background-image: url('../assets/i-like-food.svg');
}

.chat__messages {
  flex-grow: 1;
  padding: 24px 24px 0 24px;
  display: flex;
  flex-direction: column;
  overflow: auto;
  padding-bottom: 3.8rem;
}

.message {
  margin-bottom: 16px;
  background-color: var(--purple);
  padding: 8px 12px;
  border-radius: 15px;
  position: relative;
  align-self: flex-start;
}

.message::after {
  content: '';
  bottom: -10px;
  left: 0;
  border: 15px solid;
  border-color: transparent transparent transparent var(--purple);
  position: absolute;
}

.message--sent {
  background-color: var(--dark);
  align-self: flex-end;
}

.message--sent::after {
  content: '';
  bottom: -10px;
  right: 0;
  border: 15px solid;
  border-color: transparent var(--dark) transparent transparent;
  position: absolute;
}

.message > p:first-child {
  display: flex;
  justify-content: space-between;
  margin-bottom: 0;
}

.message > p:last-child {
  margin-top: 0;
  color: rgb(247, 247, 247);
}

.message__name {
  font-weight: 600;
  font-size: 14px;
  margin-right: 8px;
  align-self: flex-start;
}

.message__meta {
  color: #a58fd6;
  font-size: 14px;
  align-self: flex-end;
}

.message a {
  color: #0070cc;
}

/* Message Composition Styles */

.compose {
  display: flex;
  flex-shrink: 0;
  margin-top: 16px;
  padding: 24px;
  margin-right: 5px;
}

.compose form {
  display: flex;
  flex-grow: 1;
  margin-right: 16px;
}

.compose input {
  border: 1px solid var(--bg-color);
  width: 100%;
  padding: 12px;
  flex-grow: 1;
  background-color: var(--dark);
  border-radius: 15px 0 0 15px;
  box-sizing: border-box;
  color: var(--white);
}
.compose input:focus {
  border-color: var(--purple);
}

.compose button {
  background-color: var(--bg-color);
  padding: 12px 25px;
  font-size: 14px;
  border-radius: 0 15px 15px 0;
  font-weight: 500;
}

.compose button:focus {
  background-color: var(--bg-color);
  box-shadow: 0 0 1px 1px rgba(207, 130, 238, 0.685);
}

/* Chat Sidebar Styles */

.room-title {
  font-weight: 400;
  font-size: 22px;
  background: var(--dark);
  padding: 24px;
  border-bottom: 1px solid var(--dark-2);
  box-shadow: 0 3px 14px rgba(0, 0, 0, 0.1);
  margin-top: 0;
}

.list-title {
  color: var(--gray);
  font-weight: 500;
  font-size: 18px;
  margin-bottom: 4px;
  padding: 12px 24px 0 24px;
}

.users {
  list-style-type: none;
  font-weight: 300;
  padding-left: 0;
}
.users li {
  padding: 12px 12px 12px 25px;
  background-color: var(--dark);
}

@media screen and (max-width: 425px) {
  .chat__sidebar {
    display: none;
  }
  .chat__main {
    height: 100vh;
  }
}
</style>