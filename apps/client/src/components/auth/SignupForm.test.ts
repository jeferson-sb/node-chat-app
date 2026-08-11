import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SignupForm from './SignupForm.vue'

const { signUpEmailMock } = vi.hoisted(() => ({ signUpEmailMock: vi.fn() }))

vi.mock('../../services/auth', () => ({
  authClient: {
    signUp: { email: signUpEmailMock },
  },
}))

afterEach(() => {
  signUpEmailMock.mockReset()
})

describe('SignupForm', () => {
  it('creates an account with the entered details and emits success', async () => {
    signUpEmailMock.mockResolvedValue({ data: { token: 'abc' }, error: null })
    const wrapper = mount(SignupForm)

    await wrapper.find('input[type="text"]').setValue('Alice')
    await wrapper.find('input[type="email"]').setValue('alice@example.com')
    await wrapper.find('input[type="password"]').setValue('correct-password')
    await wrapper.find('form').trigger('submit.prevent')
    await wrapper.vm.$nextTick()

    expect(signUpEmailMock).toHaveBeenCalledWith({
      name: 'Alice',
      email: 'alice@example.com',
      password: 'correct-password',
    })
    expect(wrapper.emitted('success')).toHaveLength(1)
  })

  it('shows an error message when sign-up fails', async () => {
    signUpEmailMock.mockResolvedValue({
      data: null,
      error: { message: 'User already exists' },
    })
    const wrapper = mount(SignupForm)

    await wrapper.find('input[type="text"]').setValue('Alice')
    await wrapper.find('input[type="email"]').setValue('alice@example.com')
    await wrapper.find('input[type="password"]').setValue('correct-password')
    await wrapper.find('form').trigger('submit.prevent')
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('User already exists')
    expect(wrapper.emitted('success')).toBeUndefined()
  })
})
