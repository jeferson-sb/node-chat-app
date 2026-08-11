import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Chat from './Chat.vue'

type Handler = (...args: unknown[]) => void

const {
  socketHandlers,
  emitMock,
  disconnectMock,
  ioMock,
  notifyMock,
  getSessionMock,
} = vi.hoisted(() => {
  const socketHandlers = new Map<string, Handler>()
  const emitMock = vi.fn()
  const disconnectMock = vi.fn()
  const ioMock = vi.fn((..._args: unknown[]) => ({
    on: (event: string, handler: Handler) => {
      socketHandlers.set(event, handler)
    },
    emit: emitMock,
    disconnect: disconnectMock,
  }))
  const notifyMock = vi.fn()
  const getSessionMock = vi.fn()
  return {
    socketHandlers,
    emitMock,
    disconnectMock,
    ioMock,
    notifyMock,
    getSessionMock,
  }
})

vi.mock('socket.io-client', () => ({
  io: ioMock,
}))

vi.mock('../services/notify', () => ({
  default: notifyMock,
}))

vi.mock('../services/auth', () => ({
  authClient: { getSession: getSessionMock },
}))

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { room: 'general' } }),
}))

const mountChat = async () => {
  const wrapper = mount(Chat)
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  getSessionMock.mockResolvedValue({ data: { user: { name: 'alice' } } })
})

afterEach(() => {
  socketHandlers.clear()
  emitMock.mockClear()
  disconnectMock.mockClear()
  notifyMock.mockClear()
  ioMock.mockClear()
  getSessionMock.mockReset()
})

describe('Chat', () => {
  it('joins the room on mount, authenticated via the session cookie', async () => {
    await mountChat()

    expect(ioMock.mock.calls[0]?.[1]).toMatchObject({ withCredentials: true })
    expect(emitMock).toHaveBeenCalledWith('join', { room: 'general' })
  })

  it('renders incoming messages and notifies for messages from others', async () => {
    await mountChat()

    socketHandlers.get('message')?.({
      id: '1',
      username: 'bob',
      text: 'hi there',
      createdAt: Date.now(),
    })

    expect(notifyMock).toHaveBeenCalledWith('bob', 'hi there')
  })

  it('does not notify for the current user own messages', async () => {
    await mountChat()

    socketHandlers.get('message')?.({
      id: '1',
      username: 'alice',
      text: 'my own message',
      createdAt: Date.now(),
    })

    expect(notifyMock).not.toHaveBeenCalled()
  })

  it('renders the user list from roomData events', async () => {
    const wrapper = await mountChat()

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
    const wrapper = await mountChat()

    await wrapper.find('textarea').setValue('hello everyone')
    await wrapper.find('form').trigger('submit.prevent')

    expect(emitMock).toHaveBeenCalledWith('sendMessage', {
      message: 'hello everyone',
    })
    expect(
      (wrapper.find('textarea').element as HTMLTextAreaElement).value,
    ).toBe('')
  })

  it('disconnects the socket when unmounted', async () => {
    const wrapper = await mountChat()

    wrapper.unmount()

    expect(disconnectMock).toHaveBeenCalled()
  })
})
