import { createRouter, createWebHistory } from 'vue-router'
import { authClient } from '@/services/auth'

const AuthPage = () => import('@/components/auth/AuthPage.vue')
const RoomPicker = () => import('@/components/RoomPicker.vue')
const Chat = () => import('@/components/Chat.vue')

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'auth',
      component: AuthPage,
    },
    {
      path: '/room',
      name: 'room',
      component: RoomPicker,
      meta: { requiresAuth: true },
    },
    {
      path: '/chat/:room',
      name: 'chat',
      component: Chat,
      meta: { requiresAuth: true },
    },
  ],
})

// Accounts are mandatory (docs/adr/2026-08-09-authentication.md) - identity
// comes from the session, so picking a room or entering chat without one
// doesn't make sense. Redirects back to the auth screen instead.
router.beforeEach(async (to) => {
  if (!to.meta.requiresAuth) return true

  const { data } = await authClient.getSession()
  return data ? true : '/'
})

export default router
