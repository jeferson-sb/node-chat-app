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
      <h3 class="list-title">Rooms</h3>
      <ul class="rooms">
        <li v-for="joinedRoom in joinedRooms" :key="joinedRoom.room">
          <button
            type="button"
            :class="{ 'room-item--active': joinedRoom.room === activeRoomSlug }"
            @click="switchRoom(joinedRoom.displayName)"
          >
            {{ joinedRoom.displayName }}
          </button>
        </li>
      </ul>
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

type JoinedRoom = {
  room: string
  displayName: string
  lastJoinedAt: number
}

// Other `error` events (e.g. a rejected `sendMessage`) aren't handled here.
const INVALID_ROOM_CODE = 'INVALID_ROOM_CODE'

defineOptions({
  name: 'Chat',
})

const formatDatetime = (value: number): string =>
  new Date(value).toLocaleString()

const route = useRoute()

// Identity comes from the session, not the URL (docs/adr/2026-08-09-authentication.md).
const username = ref('')
const room = ref(String(route.params.room ?? ''))
const users = ref<ChatUser[]>([])
const messages = ref<ChatMessage[]>([])
const message = ref('')
const isActive = ref(false)
const messageInput = ref<HTMLTextAreaElement | null>(null)
const messagesContainer = ref<HTMLElement | null>(null)

// Only applies the first time this room is created - ignored otherwise.
const requestedVisibility: RoomVisibility =
  route.query?.visibility === 'private' ? 'private' : 'public'

const codeRequired = ref(false)
const codeError = ref<string | null>(null)
const joined = ref(false)
const showCodeGate = computed(() => codeRequired.value && !joined.value)
// Only ever sent to the socket that created/joined a private room.
const accessCode = ref<string | null>(null)
const joinedRooms = ref<JoinedRoom[]>([])
// The slug of whichever room this socket is currently a member of - only
// known via roomData's `room` field (the client never computes a slug
// itself, docs/adr/2026-08-16-room-name-slugs.md), used purely to
// highlight the active entry in the rooms list below.
const activeRoomSlug = ref('')

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

const switchRoom = (displayName: string): void => {
  if (displayName === room.value) return

  room.value = displayName
  messages.value = []
  users.value = []
  accessCode.value = null
  codeRequired.value = false
  codeError.value = null
  joined.value = false
  attemptJoin()
}

onMounted(async () => {
  const { data } = await authClient.getSession()
  username.value = data?.user.name ?? ''

  // websocket-only avoids sticky sessions across the load-balanced servers
  // (docs/adr/2026-08-09-modernize-stack.md); withCredentials sends the
  // session cookie for the server to verify (socketAuth.ts).
  socket = io(import.meta.env.VITE_SOCKET_URL, {
    transports: ['websocket'],
    withCredentials: true,
  })

  attemptJoin()

  socket.on('history', (history: ChatMessage[]) => {
    messages.value = history
    // Doubles as the join ack - dismisses the code gate, if it was up.
    joined.value = true
    document.title = `${room.value} · ChatMe`
  })

  socket.on('message', (msg: ChatMessage) => {
    messages.value.push(msg)
    if (msg.username !== username.value) {
      notify(msg.username, msg.text)
    }
  })

  socket.on('roomData', (data: RoomData) => {
    users.value = data.users
    activeRoomSlug.value = data.room
  })

  socket.on('joinedRooms', (rooms: JoinedRoom[]) => {
    joinedRooms.value = rooms
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
  document.title = 'ChatMe'
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
  --sidebar-size: 20cqi;
  --bubble-tail: 15px;
  --message-text: oklch(97.6% 0 0);
  --message-meta: oklch(69.6% 0.105 297.9);
  --message-link: oklch(54.4% 0.165 252.5);
  --focus-ring: oklch(72.7% 0.169 315.6 / 0.685);
  --shadow-soft: oklch(0% 0 0 / 0.1);
  --shadow-strong: oklch(0% 0 0 / 0.4);

  container: chat / inline-size;
  display: grid;
  grid-template-columns: minmax(0, auto) 1fr;
  grid-template-rows: auto 1fr;
  block-size: 100dvh;
}

header {
  display: none;
  grid-row: 1;
  grid-column: 1 / -1;
}

.chat__sidebar {
  grid-row: 2;
  grid-column: 1;
  inline-size: var(--sidebar-size);
  display: flex;
  flex-direction: column;
  color: var(--white);
  background: var(--bg-color);

  & :deep(.logout-button) {
    margin-block-start: auto;
  }
}

.chat__main {
  grid-row: 2;
  grid-column: 2;
  display: flex;
  flex-direction: column;
  min-block-size: 0;
  background-color: var(--dark-2);
  background-image: url('../assets/i-like-food.svg');
}

.chat__messages {
  flex: 1;
  min-block-size: 0;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  overflow: auto;
  padding-block: 1.5rem 3.8rem;
  padding-inline: 1.5rem;
}

.message {
  position: relative;
  align-self: flex-start;
  background-color: var(--purple);
  padding-block: 0.5rem;
  padding-inline: 0.75rem;
  border-radius: var(--bubble-tail);

  &.message--sent {
    align-self: flex-end;
    background-color: var(--dark);
  }

  & > p:first-child {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    margin-block-end: 0;
  }

  & > p:last-child {
    margin-block-start: 0;
    color: var(--message-text);
  }

  & a {
    color: var(--message-link);
  }
}

:is(.message, .message--sent)::after {
  content: '';
  position: absolute;
  inset-block-end: -10px;
  border: var(--bubble-tail) solid transparent;
}

.message::after {
  inset-inline-start: 0;
  border-inline-start-color: var(--purple);
}

.message--sent::after {
  inset-inline-start: auto;
  inset-inline-end: 0;
  border-inline-start-color: transparent;
  border-inline-end-color: var(--dark);
}

.message__name {
  font-weight: 600;
  font-size: 0.875rem;
  align-self: flex-start;
}

.message__meta {
  color: var(--message-meta);
  font-size: 0.875rem;
  align-self: flex-end;
}

.compose {
  display: flex;
  flex-shrink: 0;
  margin-block-start: 1rem;
  margin-inline-end: 0.3125rem;
  padding-block: 1.5rem;
  padding-inline: 1.5rem 2.5rem;

  & form {
    display: flex;
    flex-grow: 1;
  }

  & textarea {
    flex-grow: 1;
    inline-size: 100%;
    padding: 0.75rem;
    border: 1px solid var(--bg-color);
    border-start-start-radius: var(--bubble-tail);
    border-end-start-radius: var(--bubble-tail);
    background-color: var(--dark);
    color: var(--white);
    resize: none;

    &:focus {
      border-color: var(--purple);
    }
  }

  & button {
    padding-block: 0.75rem;
    padding-inline: 1.5625rem;
    border-start-end-radius: var(--bubble-tail);
    border-end-end-radius: var(--bubble-tail);
    background-color: var(--bg-color);
    font-size: 0.875rem;
    font-weight: 500;

    &:focus {
      background-color: var(--bg-color);
      box-shadow: 0 0 1px 1px var(--focus-ring);
    }
  }
}

.room-title {
  font-weight: 400;
  font-size: 1.375rem;
  background: var(--dark);
  padding: 1.5rem;
  border-block-end: 1px solid var(--dark-2);
  box-shadow: 0 3px 14px var(--shadow-soft);
  margin-block-start: 0;
}

.list-title {
  color: var(--gray);
  font-weight: 500;
  font-size: 1.125rem;
  margin-block-end: 0.25rem;
  padding-block: 0.75rem 0;
  padding-inline: 1.5rem;
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

.rooms {
  list-style-type: none;
  padding-inline-start: 0;
  margin-block-end: 0;

  & button {
    inline-size: 100%;
    text-align: start;
    padding-block: 0.75rem;
    padding-inline: 1.5625rem 0.75rem;
    background-color: var(--dark);
    color: var(--white);
    font-weight: 300;
    border-radius: 0;

    &:hover {
      background-color: var(--dark-2);
    }

    &.room-item--active {
      color: var(--purple);
      font-weight: 600;
    }
  }
}

.users {
  list-style-type: none;
  font-weight: 300;
  padding-inline-start: 0;

  & li {
    padding-block: 0.75rem;
    padding-inline: 1.5625rem 0.75rem;
    background-color: var(--dark);
  }
}

.user {
  display: flex;
  align-items: center;
  gap: 0.5rem;
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

/* Visually hidden but still available to screen readers. */
.sr-only {
  position: absolute;
  inline-size: 1px;
  block-size: 1px;
  padding: 0;
  margin-inline: -1px;
  margin-block: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}

@container chat (width <= 500px) {
  header {
    display: block;
  }

  .chat__sidebar {
    display: none;
  }

  .compose {
    padding-inline-end: 1.5rem;
  }

  header nav {
    position: relative;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-block: 0.125rem;
    padding-inline: 1rem;
    background-color: var(--bg-color);
    box-shadow: 1px 3px 15px var(--shadow-strong);

    & h4 {
      order: 2;
      letter-spacing: 1px;
      font-weight: 800;
      font-size: 1.1rem;
      text-align: end;
    }
  }

  .sidebar-mobile {
    position: relative;

    & .toggle__sidebar {
      font-size: 1rem;
      font-weight: 600;
      background-color: var(--dark-2);
      border: none;
      border-radius: 4px;
      padding-block: 0.375rem;
      padding-inline: 1.125rem;
      cursor: pointer;
    }
  }

  /* `.users.show` outranks `opacity: 0` on specificity alone. */
  .users {
    position: absolute;
    display: block;
    z-index: 2;
    opacity: 0;
    color: var(--white);
    inset-block-start: 2.5rem;
    /* cqi, not %: the positioned parent is only as wide as its toggle. */
    inline-size: min(18.75rem, 90cqi);

    &.show {
      opacity: 1;
    }

    &::after {
      content: '';
      position: absolute;
      inset-block-start: -15px;
      inset-inline-start: 0;
      border: var(--bubble-tail) solid transparent;
      border-inline-start-color: var(--dark);
    }
  }
}

/* Shell for RoomCodeGate.vue, shown instead of .chat while a private
   room's access code hasn't been validated yet. */
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
