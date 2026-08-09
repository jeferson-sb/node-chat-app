import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Join from './Join.vue'

const pushMock = vi.fn()

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: pushMock }),
}))

afterEach(() => {
  pushMock.mockClear()
})

describe('Join', () => {
  it('navigates to the chat room with the entered username and room', async () => {
    const wrapper = mount(Join)

    await wrapper.find('input[name="username"]').setValue('alice')
    await wrapper.find('input[name="room"]').setValue('general')
    await wrapper.find('form').trigger('submit.prevent')

    expect(pushMock).toHaveBeenCalledWith('/chat/alice/general')
  })

  it('requires both username and room fields', () => {
    const wrapper = mount(Join)

    expect(
      wrapper.find('input[name="username"]').attributes('required'),
    ).toBeDefined()
    expect(
      wrapper.find('input[name="room"]').attributes('required'),
    ).toBeDefined()
  })
})
