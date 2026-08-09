import { createRouter, createWebHistory } from 'vue-router'

const Join = () => import('@/components/Join.vue')
const Chat = () => import('@/components/Chat.vue')

export default createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'join',
      component: Join,
    },
    {
      path: '/chat/:username/:room',
      name: 'chat',
      component: Chat,
    },
  ],
})
