import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RoomPicker from './RoomPicker.vue'

const pushMock = vi.fn()

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: pushMock }),
}))

afterEach(() => {
  pushMock.mockClear()
})

describe('RoomPicker', () => {
  it('navigates to the chosen room', async () => {
    const wrapper = mount(RoomPicker)

    await wrapper.find('input[name="room"]').setValue('general')
    await wrapper.find('form').trigger('submit.prevent')

    expect(pushMock).toHaveBeenCalledWith('/chat/general')
  })

  it('requires the room field', () => {
    const wrapper = mount(RoomPicker)

    expect(
      wrapper.find('input[name="room"]').attributes('required'),
    ).toBeDefined()
  })
})
