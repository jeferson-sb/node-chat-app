import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import RoomCodeGate from './RoomCodeGate.vue'

describe('RoomCodeGate', () => {
  it('names the room the code is for', () => {
    const wrapper = mount(RoomCodeGate, { props: { room: 'secret-club' } })

    expect(wrapper.text()).toContain('secret-club')
  })

  it('emits the entered code on submit', async () => {
    const wrapper = mount(RoomCodeGate, { props: { room: 'secret-club' } })

    await wrapper.find('input[name="code"]').setValue('123456')
    await wrapper.find('form').trigger('submit.prevent')

    expect(wrapper.emitted('submit')).toEqual([['123456']])
  })

  it('renders a server-supplied error message', () => {
    const wrapper = mount(RoomCodeGate, {
      props: { room: 'secret-club', error: 'Invalid access code' },
    })

    expect(wrapper.text()).toContain('Invalid access code')
  })

  it('renders no error message by default', () => {
    const wrapper = mount(RoomCodeGate, { props: { room: 'secret-club' } })

    expect(wrapper.find('.room-code-gate__error').exists()).toBe(false)
  })

  it('requires the code field', () => {
    const wrapper = mount(RoomCodeGate, { props: { room: 'secret-club' } })

    expect(
      wrapper.find('input[name="code"]').attributes('required'),
    ).toBeDefined()
  })
})
