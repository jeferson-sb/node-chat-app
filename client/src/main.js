import Vue from 'vue'
import VueChatScroll from 'vue-chat-scroll'
import App from './App.vue'
import router from './router'
import './assets/css/global.css'

Vue.use(VueChatScroll)

new Vue({
  router,
  render: (h) => h(App),
}).$mount('#app')
