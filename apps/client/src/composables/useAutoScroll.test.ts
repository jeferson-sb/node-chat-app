import { defineComponent, h, nextTick, ref, type Ref } from 'vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { useAutoScroll } from './useAutoScroll'

/**
 * happy-dom's scroll layout properties (scrollHeight/scrollTop/clientHeight)
 * are all 0 by default and can't be resized like a real browser viewport,
 * so each test stubs them directly on the mounted container element to
 * drive the "is the user at the bottom?" branch under test.
 */
const mountWithContainer = (source: Ref<number[]>) => {
  const TestComponent = defineComponent({
    setup() {
      const container = ref<HTMLElement | null>(null)
      useAutoScroll(container, source, { smooth: false })
      return () => h('div', { ref: container })
    },
  })

  return mount(TestComponent)
}

describe('useAutoScroll', () => {
  it('scrolls to the bottom on mount', () => {
    const calls: ScrollToOptions[] = []
    const originalScroll = HTMLElement.prototype.scroll
    HTMLElement.prototype.scroll = ((opts: ScrollToOptions) => {
      calls.push(opts)
    }) as typeof HTMLElement.prototype.scroll

    const source = ref<number[]>([1, 2, 3])
    mountWithContainer(source)

    expect(calls).toHaveLength(1)
    expect(calls[0]?.behavior).toBe('instant')

    HTMLElement.prototype.scroll = originalScroll
  })

  it('auto-scrolls when a new message arrives and the user is at the bottom', async () => {
    const source = ref<number[]>([1])
    const wrapper = mountWithContainer(source)
    const el = wrapper.element as HTMLElement
    Object.defineProperty(el, 'scrollHeight', {
      value: 100,
      configurable: true,
    })
    Object.defineProperty(el, 'clientHeight', { value: 50, configurable: true })
    Object.defineProperty(el, 'scrollTop', {
      value: 50,
      configurable: true,
      writable: true,
    })
    let scrolledTo: number | undefined
    el.scroll = ((opts: ScrollToOptions) => {
      scrolledTo = opts.top
    }) as typeof el.scroll

    source.value = [1, 2]
    await nextTick()
    await nextTick()

    expect(scrolledTo).toBe(100)
  })

  it('does not auto-scroll when the user has scrolled up to read older messages', async () => {
    const source = ref<number[]>([1])
    const wrapper = mountWithContainer(source)
    const el = wrapper.element as HTMLElement
    Object.defineProperty(el, 'scrollHeight', {
      value: 500,
      configurable: true,
    })
    Object.defineProperty(el, 'clientHeight', { value: 50, configurable: true })
    Object.defineProperty(el, 'scrollTop', {
      value: 0,
      configurable: true,
      writable: true,
    })
    let scrollCalled = false
    el.scroll = (() => {
      scrollCalled = true
    }) as typeof el.scroll

    source.value = [1, 2]
    await nextTick()
    await nextTick()

    expect(scrollCalled).toBe(false)
  })
})
