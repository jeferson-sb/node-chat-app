declare module '*.vue' {
  import Vue from 'vue';
  export default Vue;
}

declare module 'vue-chat-scroll' {
  import type { PluginObject } from 'vue';

  const VueChatScroll: PluginObject<never>;
  export default VueChatScroll;
}
