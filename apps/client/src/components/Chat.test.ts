import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Chat from './Chat.vue'

type Handler = (...args: unknown[]) => void

const { socketHandlers, emitMock, disconnectMock, ioMock, notifyMock } =
  vi.hoisted(() => {
    const socketHandlers = new Map<string, Handler>()
    const emitMock = vi.fn()
    const disconnectMock = vi.fn()
    const ioMock = vi.fn(() => ({
      on: (event: string, handler: Handler) => {
        socketHandlers.set(event, handler)
      },
      emit: emitMock,
      disconnect: disconnectMock,
    }))
    const notifyMock = vi.fn()
    return { socketHandlers, emitMock, disconnectMock, ioMock, notifyMock }
  })

vi.mock('socket.io-client', () => ({
  io: ioMock,
}))

vi.mock('../services/notify', () => ({
  default: notifyMock,
}))

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { username: 'alice', room: 'general' } }),
}))

afterEach(() => {
  socketHandlers.clear()
  emitMock.mockClear()
  disconnectMock.mockClear()
  notifyMock.mockClear()
  ioMock.mockClear()
})

describe('Chat', () => {
  it('joins the room on mount', () => {
    mount(Chat)

    expect(emitMock).toHaveBeenCalledWith('join', {
      username: 'alice',
      room: 'general',
    })
  })

  it('renders incoming messages and notifies for messages from others', () => {
    mount(Chat)

    socketHandlers.get('message')?.({
      id: '1',
      username: 'bob',
      text: 'hi there',
      createdAt: Date.now(),
    })

    expect(notifyMock).toHaveBeenCalledWith('bob', 'hi there')
  })

  it('does not notify for the current user own messages', () => {
    mount(Chat)

    socketHandlers.get('message')?.({
      id: '1',
      username: 'alice',
      text: 'my own message',
      createdAt: Date.now(),
    })

    expect(notifyMock).not.toHaveBeenCalled()
  })

  it('renders the user list from roomData events', async () => {
    const wrapper = mount(Chat)

    socketHandlers.get('roomData')?.({
      room: 'general',
      users: [
        { username: 'alice', room: 'general', socketId: 's1' },
        { username: 'bob', room: 'general', socketId: 's2' },
      ],
    })
    await wrapper.vm.$nextTick()

    const items = wrapper.findAll('.chat__sidebar .users li')
    expect(items).toHaveLength(2)
    expect(items[0]?.text()).toBe('alice')
    expect(items[1]?.text()).toBe('bob')
  })

  it('sends a message and clears the input', async () => {
    const wrapper = mount(Chat)

    await wrapper.find('textarea').setValue('hello everyone')
    await wrapper.find('form').trigger('submit.prevent')

    expect(emitMock).toHaveBeenCalledWith('sendMessage', {
      username: 'alice',
      message: 'hello everyone',
    })
    expect(
      (wrapper.find('textarea').element as HTMLTextAreaElement).value,
    ).toBe('')
  })

  it('disconnects the socket when unmounted', () => {
    const wrapper = mount(Chat)

    wrapper.unmount()

    expect(disconnectMock).toHaveBeenCalled()
  })
})
