import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import LogoutButton from './LogoutButton.vue'

const { signOutMock, pushMock } = vi.hoisted(() => ({
  signOutMock: vi.fn(),
  pushMock: vi.fn(),
}))

vi.mock('../services/auth', () => ({
  authClient: { signOut: signOutMock },
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: pushMock }),
}))

afterEach(() => {
  signOutMock.mockReset()
  pushMock.mockClear()
})

describe('LogoutButton', () => {
  it('signs out when clicked', async () => {
    signOutMock.mockResolvedValue({ data: {}, error: null })
    const wrapper = mount(LogoutButton)

    await wrapper.find('button').trigger('click')
    await wrapper.vm.$nextTick()

    expect(signOutMock).toHaveBeenCalled()
  })

  it('navigates to / after signing out successfully', async () => {
    signOutMock.mockResolvedValue({ data: {}, error: null })
    const wrapper = mount(LogoutButton)

    await wrapper.find('button').trigger('click')
    await wrapper.vm.$nextTick()

    expect(pushMock).toHaveBeenCalledWith('/')
  })

  it('shows an error and does not navigate when sign-out fails', async () => {
    signOutMock.mockResolvedValue({
      data: null,
      error: { message: 'Unable to sign out' },
    })
    const wrapper = mount(LogoutButton)

    await wrapper.find('button').trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('Unable to sign out')
    expect(pushMock).not.toHaveBeenCalled()
  })
})
