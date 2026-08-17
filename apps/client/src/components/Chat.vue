<template>
  <section v-if="showCodeGate" class="centered-form">
    <div class="centered-form__box puff-in-center">
      <RoomCodeGate
        :room="room"
        :error="codeError"
        @submit="handleCodeSubmit"
      />
    </div>
  </section>
  <main v-else class="chat">
    <header>
      <nav>
        <h4>ChatMe</h4>
        <div class="sidebar-mobile">
          <button class="toggle__sidebar" @click="isActive = !isActive">
            {{ room }}
          </button>
          <ul :class="['users', isActive ? 'show' : '']">
            <li
              v-for="user in users"
              :key="user.socketId"
              :class="['user', user.online ? 'user--online' : 'user--offline']"
            >
              <span class="user__status" aria-hidden="true"></span>
              {{ user.username }}
              <span class="sr-only">{{
                user.online ? 'online' : 'offline'
              }}</span>
            </li>
          </ul>
        </div>
      </nav>
    </header>
    <aside id="sidebar" class="chat__sidebar">
      <h2 class="room-title">
        {{ room }}
      </h2>
      <p v-if="accessCode" class="room-access-code">
        Access code: <strong>{{ accessCode }}</strong>
      </p>
      <h3 class="list-title">Users</h3>
      <ul class="users">
        <li
          v-for="user in users"
          :key="user.socketId"
          :class="['user', user.online ? 'user--online' : 'user--offline']"
        >
          <span class="user__status" aria-hidden="true"></span>
          {{ user.username }}
          <span class="sr-only">{{ user.online ? 'online' : 'offline' }}</span>
        </li>
      </ul>
      <LogoutButton />
    </aside>
    <div class="chat__main">
      <div id="messages" ref="messagesContainer" class="chat__messages">
        <div
          v-for="message in messages"
          :key="message.id"
          :class="[
            'message',
            message.username === username ? 'message--sent' : '',
          ]"
        >
          <p>
            <span
              v-show="message.username !== username"
              class="message__name"
              >{{ message.username }}</span
            >
            <time class="message__meta" :datetime="String(message.createdAt)">{{
              formatDatetime(message.createdAt)
            }}</time>
          </p>
          <p>{{ message.text }}</p>
        </div>
      </div>

      <div class="compose">
        <form id="message-form" @submit.prevent="sendMessage">
          <!-- maxlength must match Message.MAX_TEXT_LENGTH in apps/server/src/domain/Message.ts, the authoritative limit -->
          <textarea
            ref="messageInput"
            v-model="message"
            name="message"
            placeholder="Type your message ..."
            required
            maxlength="100000"
            autocomplete="off"
            autocorrect="off"
            autocapitalize="off"
            @keyup.enter="sendMessage"
          />
          <button type="submit">Send</button>
        </form>
      </div>
    </div>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import { useRoute } from 'vue-router'
import { io, type Socket } from 'socket.io-client'
import notify from '../services/notify'
import { authClient } from '../services/auth'
import { useAutoScroll } from '../composables/useAutoScroll'
import LogoutButton from './LogoutButton.vue'
import RoomCodeGate from './RoomCodeGate.vue'

type ChatUser = {
  username: string
  room: string
  socketId: string
  online: boolean
}

type ChatMessage = {
  id: string
  username: string
  text: string
  createdAt: number
}

type RoomData = {
  room: string
  users: ChatUser[]
}

type RoomVisibility = 'public' | 'private'

type JoinPayload = {
  room: string
  visibility?: RoomVisibility
  code?: string
}

type SocketErrorPayload = {
  code: string
  message: string
}

type PrivateRoomCodePayload = {
  room: string
  code: string
}

/** Only this domain error is relevant to the pre-chat code gate below - any
 * other `error` event (e.g. a rejected `sendMessage`) is left for a future
 * change, same as today (docs/adr/2026-08-14-logging-and-domain-errors.md). */
const INVALID_ROOM_CODE = 'INVALID_ROOM_CODE'

defineOptions({
  name: 'Chat',
})

const formatDatetime = (value: number): string =>
  new Date(value).toLocaleString()

const route = useRoute()

// Identity comes from the session, not the URL - accounts are mandatory
// (docs/adr/2026-08-09-authentication.md), and the router guard already
// keeps unauthenticated visitors from reaching this route (router.ts).
const username = ref('')
const room = ref(String(route.params.room ?? ''))
const users = ref<ChatUser[]>([])
const messages = ref<ChatMessage[]>([])
const message = ref('')
const isActive = ref(false)
const messageInput = ref<HTMLTextAreaElement | null>(null)
const messagesContainer = ref<HTMLElement | null>(null)

// Only meaningful the first time this room is ever joined - the server
// ignores it for a room that already exists (Task 12). Set via
// RoomPicker's radio and carried over as a query param (router.ts has no
// dedicated "create room" route, so this is the only channel for it).
const requestedVisibility: RoomVisibility =
  route.query?.visibility === 'private' ? 'private' : 'public'

// Gates the chat UI behind a code prompt when the room turns out to be
// private and no/an invalid code was supplied - see the `error` handler
// below. `joined` flips true once the server actually lets this socket
// in (signaled by the `history` snapshot every successful join emits).
const codeRequired = ref(false)
const codeError = ref<string | null>(null)
const joined = ref(false)
const showCodeGate = computed(() => codeRequired.value && !joined.value)
// Only ever set for a private room, and only to this socket - see
// eventTypes.ts's privateRoomCode doc comment on the server.
const accessCode = ref<string | null>(null)

useAutoScroll(messagesContainer, messages, { smooth: true })

let socket: Socket

const attemptJoin = (code?: string): void => {
  const payload: JoinPayload = { room: room.value }
  if (requestedVisibility === 'private') payload.visibility = 'private'
  if (code) payload.code = code
  socket.emit('join', payload)
}

const handleCodeSubmit = (code: string): void => {
  codeError.value = null
  attemptJoin(code)
}

onMounted(async () => {
  const { data } = await authClient.getSession()
  username.value = data?.user.name ?? ''

  // Force websocket-only (skip the HTTP long-polling handshake) so the
  // client keeps a single persistent connection to whichever server the
  // load balancer picks — sticky sessions are only required for
  // long-polling's repeated HTTP requests, not a single websocket
  // connection. See docs/adr/2026-08-09-modernize-stack.md and
  // docker-compose.yml's round-robin Nginx upstream.
  // withCredentials sends the session cookie on the handshake - the
  // server verifies it (socketAuth.ts) instead of trusting a
  // client-supplied username.
  socket = io(import.meta.env.VITE_SOCKET_URL, {
    transports: ['websocket'],
    withCredentials: true,
  })

  attemptJoin()

  socket.on('history', (history: ChatMessage[]) => {
    messages.value = history
    // The server only ever emits `history` right after a successful join
    // (SocketController.onJoinRoom) - there's no separate "joined" ack,
    // so this is the signal that dismisses the code gate, if it was up.
    joined.value = true
  })

  socket.on('message', (msg: ChatMessage) => {
    messages.value.push(msg)
    if (msg.username !== username.value) {
      notify(msg.username, msg.text)
    }
  })

  socket.on('roomData', (data: RoomData) => {
    users.value = data.users
  })

  socket.on('privateRoomCode', ({ code }: PrivateRoomCodePayload) => {
    accessCode.value = code
  })

  socket.on('error', (err: SocketErrorPayload) => {
    if (err.code !== INVALID_ROOM_CODE) return
    codeRequired.value = true
    codeError.value = err.message
  })
})

onBeforeUnmount(() => {
  socket?.disconnect()
})

const sendMessage = (e: KeyboardEvent | SubmitEvent): void => {
  if (e instanceof KeyboardEvent && e.shiftKey) return

  socket.emit('sendMessage', {
    message: message.value,
  })
  message.value = ''
  messageInput.value?.focus()
}
</script>

<style scoped>
.chat {
  display: grid;
  grid-template-columns: 20% auto;
  grid-template-rows: 1fr;
}

.chat__sidebar {
  height: 100vh;
  display: flex;
  flex-direction: column;
  color: var(--white);
  background: var(--bg-color);
}

.chat__sidebar :deep(.logout-button) {
  margin-top: auto;
}

header {
  display: none;
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

.compose textarea {
  border: 1px solid var(--bg-color);
  width: 100%;
  padding: 12px;
  flex-grow: 1;
  background-color: var(--dark);
  border-radius: 15px 0 0 15px;
  box-sizing: border-box;
  color: var(--white);
  resize: none;
}

.compose textarea:focus {
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

.room-access-code {
  color: var(--gray);
  font-size: 0.875rem;
  padding-inline: 24px;
  margin-block: 0.75rem;
}

.room-access-code strong {
  color: var(--white);
  letter-spacing: 1px;
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

.user {
  display: flex;
  align-items: center;
  gap: 8px;
}

.user__status {
  inline-size: 8px;
  block-size: 8px;
  border-radius: 50%;
  background-color: var(--offline);
  flex-shrink: 0;
}

.user--online .user__status {
  background-color: var(--online);
}

/* Visually hidden but still available to screen readers - the dot alone
   isn't enough to convey online/offline. */
.sr-only {
  position: absolute;
  inline-size: 1px;
  block-size: 1px;
  padding: 0;
  margin-inline: -1px;
  margin-block: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@media screen and (max-width: 500px) {
  .chat {
    grid-template-columns: 1fr;
  }

  .chat__sidebar {
    display: none;
  }

  .chat__main {
    height: 100vh;
  }

  .chat__messages {
    flex-grow: 0.8;
    padding-bottom: 0;
    margin-bottom: 180px;
  }

  .compose {
    margin-right: 0;
    position: absolute;
    bottom: 4px;
    width: 100%;
    box-sizing: border-box;
  }

  header {
    display: block;
    width: 100%;
  }

  header nav {
    background-color: var(--bg-color);
    padding: 2px 16px;
    box-shadow: 1px 3px 15px rgba(0, 0, 0, 0.4);
    position: relative;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  header nav h4 {
    letter-spacing: 1px;
    font-weight: 800;
    font-size: 1.1rem;
    text-align: right;
    order: 2;
  }

  .show {
    opacity: 1 !important;
  }

  .sidebar-mobile {
    position: relative;
  }

  .users {
    opacity: 0;
    position: absolute;
    display: block;
    z-index: 2;
    color: var(--white);
    top: 40px;
    width: 300px;
  }

  .users::after {
    content: '';
    top: -15px;
    left: 0;
    border: 15px solid;
    border-color: transparent transparent transparent var(--dark);
    position: absolute;
  }

  .sidebar-mobile .toggle__sidebar {
    font-size: 1rem;
    background-color: var(--dark-2);
    font-weight: 600;
    border-radius: 4px;
    padding: 6px 18px;
    border: none;
    cursor: pointer;
  }

  .compose form {
    margin-right: 0;
  }
}

/* Code gate (RoomCodeGate.vue), shown instead of .chat while a private
   room's access code hasn't been validated yet - shell styling lives
   here rather than in the child component, same split as AuthPage.vue
   owns its own LoginForm/SignupForm's shell. */
.centered-form {
  background-color: var(--bg-color);
  background-image: url('../assets/bg-illustration.svg');
  background-position: center;
  background-size: cover;
  block-size: 100vh;
  display: flex;
  justify-content: center;
  align-items: center;
}

.centered-form__box {
  border-radius: 5px;
  background: var(--dark-2);
  padding: 40px;
  width: 420px;
  font-size: 18px;
  box-shadow: 0 2px 10px 0 rgba(0, 0, 0, 0.2);
}

.centered-form :deep(input) {
  margin-block-end: 1rem;
  inline-size: 100%;
  padding: 10px;
  box-sizing: border-box;
  border-radius: 3px;
  border: 1px solid #0000004d;
  background-color: #0000004d;
  color: var(--white);
}

.centered-form :deep(input:focus) {
  border-color: var(--purple);
}

.centered-form :deep(button[type='submit']) {
  background: var(--purple);
  font-weight: 600;
  letter-spacing: 1.1px;
  line-height: 16px;
  min-height: 40px;
  inline-size: 100%;
}

.centered-form :deep(button[type='submit']:hover) {
  background: var(--light-purple);
}

.centered-form :deep(.room-code-gate__error) {
  color: var(--error);
  font-size: 0.875rem;
  margin-block-start: -8px;
  margin-block-end: 1rem;
}

.puff-in-center {
  animation: puff-in-center 0.7s cubic-bezier(0.47, 0, 0.745, 0.715) both;
}
@keyframes puff-in-center {
  0% {
    transform: scale(2);
    filter: blur(2px);
    opacity: 0;
  }
  100% {
    transform: scale(1);
    filter: blur(0px);
    opacity: 1;
  }
}
</style>
