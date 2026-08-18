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
  useRouter: () => ({ push: vi.fn() }),
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

  it('renders history received on join, then appends live messages after it', async () => {
    const wrapper = await mountChat()

    socketHandlers.get('history')?.([
      { id: '1', username: 'alice', text: 'earlier message', createdAt: 1 },
    ])
    socketHandlers.get('message')?.({
      id: '2',
      username: 'bob',
      text: 'live message',
      createdAt: 2,
    })
    await wrapper.vm.$nextTick()

    const rendered = wrapper.findAll('#messages .message')
    expect(rendered).toHaveLength(2)
    expect(rendered[0]?.text()).toContain('earlier message')
    expect(rendered[1]?.text()).toContain('live message')
  })

  it('renders the user list from roomData events', async () => {
    const wrapper = await mountChat()

    socketHandlers.get('roomData')?.({
      room: 'general',
      users: [
        { username: 'alice', room: 'general', socketId: 's1', online: true },
        { username: 'bob', room: 'general', socketId: 's2', online: false },
      ],
    })
    await wrapper.vm.$nextTick()

    const items = wrapper.findAll('.chat__sidebar .users li')
    expect(items).toHaveLength(2)
    expect(items[0]?.text()).toContain('alice')
    expect(items[1]?.text()).toContain('bob')
  })

  it('renders distinct online/offline indicators per user', async () => {
    const wrapper = await mountChat()

    socketHandlers.get('roomData')?.({
      room: 'general',
      users: [
        { username: 'alice', room: 'general', socketId: 's1', online: true },
        { username: 'bob', room: 'general', socketId: 's2', online: false },
      ],
    })
    await wrapper.vm.$nextTick()

    const items = wrapper.findAll('.chat__sidebar .users li')
    expect(items[0]?.classes()).toContain('user--online')
    expect(items[0]?.text()).toContain('online')
    expect(items[1]?.classes()).toContain('user--offline')
    expect(items[1]?.text()).toContain('offline')
  })

  it('renders the joined-rooms list and switches rooms on click', async () => {
    const wrapper = await mountChat()

    socketHandlers.get('joinedRooms')?.([
      { room: 'general-abc123', displayName: 'general', lastJoinedAt: 2 },
      { room: 'random-def456', displayName: 'random', lastJoinedAt: 1 },
    ])
    await wrapper.vm.$nextTick()

    const items = wrapper.findAll('.chat__sidebar .rooms li')
    expect(items).toHaveLength(2)
    expect(items[0]?.text()).toContain('general')
    expect(items[1]?.text()).toContain('random')

    emitMock.mockClear()
    await items[1]?.find('button').trigger('click')

    expect(emitMock).toHaveBeenCalledWith('join', { room: 'random' })
  })

  it('clears messages and users from the previous room when switching', async () => {
    const wrapper = await mountChat()
    socketHandlers.get('history')?.([
      { id: '1', username: 'alice', text: 'old room message', createdAt: 1 },
    ])
    socketHandlers.get('roomData')?.({
      room: 'general',
      users: [
        { username: 'alice', room: 'general', socketId: 's1', online: true },
      ],
    })
    socketHandlers.get('joinedRooms')?.([
      { room: 'general-abc123', displayName: 'general', lastJoinedAt: 2 },
      { room: 'random-def456', displayName: 'random', lastJoinedAt: 1 },
    ])
    await wrapper.vm.$nextTick()

    await wrapper
      .findAll('.chat__sidebar .rooms li button')[1]
      ?.trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.findAll('#messages .message')).toHaveLength(0)
    expect(wrapper.findAll('.chat__sidebar .users li')).toHaveLength(0)
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

  it('limits the message input to 100,000 characters', async () => {
    const wrapper = await mountChat()

    expect(wrapper.find('textarea').attributes('maxlength')).toBe('100000')
  })

  it('renders a logout control', async () => {
    const wrapper = await mountChat()

    expect(wrapper.find('.chat__sidebar button').text()).toBe('Log out')
  })

  it('disconnects the socket when unmounted', async () => {
    const wrapper = await mountChat()

    wrapper.unmount()

    expect(disconnectMock).toHaveBeenCalled()
  })

  describe('private rooms', () => {
    it('shows a code gate instead of the chat when the server rejects the join for a missing code', async () => {
      const wrapper = await mountChat()

      socketHandlers.get('error')?.({
        code: 'INVALID_ROOM_CODE',
        message: 'Room "general" requires an access code',
      })
      await wrapper.vm.$nextTick()

      expect(wrapper.find('.chat').exists()).toBe(false)
      expect(wrapper.text()).toContain('Room "general" requires an access code')
    })

    it('ignores error events unrelated to the room code', async () => {
      const wrapper = await mountChat()

      socketHandlers.get('error')?.({
        code: 'ROOM_NOT_FOUND',
        message: 'no active room membership',
      })
      await wrapper.vm.$nextTick()

      expect(wrapper.find('.chat').exists()).toBe(true)
    })

    it('resubmits the join with the entered code from the gate', async () => {
      const wrapper = await mountChat()
      socketHandlers.get('error')?.({
        code: 'INVALID_ROOM_CODE',
        message: 'Room "general" requires an access code',
      })
      await wrapper.vm.$nextTick()
      emitMock.mockClear()

      await wrapper.find('input[name="code"]').setValue('123456')
      await wrapper.find('form').trigger('submit.prevent')

      expect(emitMock).toHaveBeenCalledWith('join', {
        room: 'general',
        code: '123456',
      })
    })

    it('dismisses the code gate once the server accepts the join', async () => {
      const wrapper = await mountChat()
      socketHandlers.get('error')?.({
        code: 'INVALID_ROOM_CODE',
        message: 'Room "general" requires an access code',
      })
      await wrapper.vm.$nextTick()

      socketHandlers.get('history')?.([])
      await wrapper.vm.$nextTick()

      expect(wrapper.find('.chat').exists()).toBe(true)
    })

    it('displays the access code received for a private room', async () => {
      const wrapper = await mountChat()

      socketHandlers.get('privateRoomCode')?.({
        room: 'general',
        code: '654321',
      })
      await wrapper.vm.$nextTick()

      expect(wrapper.text()).toContain('654321')
    })
  })
})
