import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AuthPage from './AuthPage.vue'
import LoginForm from './LoginForm.vue'
import SignupForm from './SignupForm.vue'

const pushMock = vi.fn()

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: pushMock }),
}))

afterEach(() => {
  pushMock.mockClear()
})

describe('AuthPage', () => {
  it('shows the login form by default', () => {
    const wrapper = mount(AuthPage)

    expect(wrapper.findComponent(LoginForm).exists()).toBe(true)
    expect(wrapper.findComponent(SignupForm).exists()).toBe(false)
  })

  it('switches to the signup form when the Sign Up tab is clicked', async () => {
    const wrapper = mount(AuthPage)

    await wrapper.find('button[role="tab"]:nth-of-type(2)').trigger('click')

    expect(wrapper.findComponent(SignupForm).exists()).toBe(true)
    expect(wrapper.findComponent(LoginForm).exists()).toBe(false)
  })

  it('navigates to the room picker when login succeeds', async () => {
    const wrapper = mount(AuthPage)

    await wrapper.findComponent(LoginForm).vm.$emit('success')

    expect(pushMock).toHaveBeenCalledWith('/room')
  })

  it('navigates to the room picker when signup succeeds', async () => {
    const wrapper = mount(AuthPage)
    await wrapper.find('button[role="tab"]:nth-of-type(2)').trigger('click')

    await wrapper.findComponent(SignupForm).vm.$emit('success')

    expect(pushMock).toHaveBeenCalledWith('/room')
  })
})
