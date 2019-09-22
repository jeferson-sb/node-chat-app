import Vue from 'vue'
import Router from 'vue-router'
const Join = () =>
  import(/* webpackChunkName: "join-page" */ '@/components/Join.vue')
const Chat = () =>
  import(/* webpackChunkName: "chat-page" */ '@/components/Chat.vue')

Vue.use(Router)

export default new Router({
  mode: 'history',
  routes: [
    {
      path: '/',
      name: 'join',
      component: Join
    },
    {
      path: '/chat/:username/:room',
      name: 'chat',
      component: Chat
    }
  ]
})
