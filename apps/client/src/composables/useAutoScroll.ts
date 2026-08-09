import { nextTick, onMounted, watch, type Ref } from 'vue'

type AutoScrollOptions = {
  smooth?: boolean
}

/**
 * Scrolls a container to its bottom whenever `source`'s length grows, but
 * only if the user was already at (or near) the bottom — mirrors
 * vue-chat-scroll's `{ always: false }` behavior of not yanking the view
 * back down while someone is reading older messages.
 */
export const useAutoScroll = (
  container: Ref<HTMLElement | null>,
  source: Ref<unknown[]>,
  options: AutoScrollOptions = {},
): void => {
  const scrollToBottom = (el: HTMLElement): void => {
    el.scroll({
      top: el.scrollHeight,
      behavior: options.smooth ? 'smooth' : 'instant',
    })
  }

  const isAtBottom = (el: HTMLElement): boolean =>
    el.scrollHeight - el.scrollTop - el.clientHeight < 1

  onMounted(() => {
    if (container.value) {
      scrollToBottom(container.value)
    }
  })

  watch(
    () => source.value.length,
    async () => {
      const el = container.value
      if (!el || !isAtBottom(el)) return

      await nextTick()
      scrollToBottom(el)
    },
  )
}
