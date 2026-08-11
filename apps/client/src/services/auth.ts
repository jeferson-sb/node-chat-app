import { createAuthClient } from 'better-auth/vue'

// Reuses VITE_SOCKET_URL rather than adding a new env var - the Socket.io
// server and Better Auth are the same Express process (see
// apps/server/src/presentation/createApp.ts).
export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_SOCKET_URL,
})
