import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import LoginForm from './LoginForm.vue'

const { signInEmailMock } = vi.hoisted(() => ({ signInEmailMock: vi.fn() }))

vi.mock('../../services/auth', () => ({
  authClient: {
    signIn: { email: signInEmailMock },
  },
}))

afterEach(() => {
  signInEmailMock.mockReset()
})

describe('LoginForm', () => {
  it('logs in with the entered credentials and emits success', async () => {
    signInEmailMock.mockResolvedValue({ data: { token: 'abc' }, error: null })
    const wrapper = mount(LoginForm)

    await wrapper.find('input[type="email"]').setValue('alice@example.com')
    await wrapper.find('input[type="password"]').setValue('correct-password')
    await wrapper.find('form').trigger('submit.prevent')
    await wrapper.vm.$nextTick()

    expect(signInEmailMock).toHaveBeenCalledWith({
      email: 'alice@example.com',
      password: 'correct-password',
    })
    expect(wrapper.emitted('success')).toHaveLength(1)
  })

  it('shows an error message when sign-in fails', async () => {
    signInEmailMock.mockResolvedValue({
      data: null,
      error: { message: 'Invalid email or password' },
    })
    const wrapper = mount(LoginForm)

    await wrapper.find('input[type="email"]').setValue('alice@example.com')
    await wrapper.find('input[type="password"]').setValue('wrong-password')
    await wrapper.find('form').trigger('submit.prevent')
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('Invalid email or password')
    expect(wrapper.emitted('success')).toBeUndefined()
  })
})
