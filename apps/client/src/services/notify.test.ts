import { describe, expect, it, vi } from 'vitest'
import notify from './notify'

describe('notify', () => {
  it('warns when the Notification API is unavailable', () => {
    const originalNotification = window.Notification
    // @ts-expect-error - simulating an environment without Notification support
    window.Notification = undefined
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    notify('alice', 'hello')

    expect(warnSpy).toHaveBeenCalledWith('Please enable notifications')

    window.Notification = originalNotification
    warnSpy.mockRestore()
  })

  it('warns when notifications are denied', () => {
    const originalNotification = window.Notification
    // @ts-expect-error - minimal stub of the Notification API
    window.Notification = { permission: 'denied' }
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    notify('alice', 'hello')

    expect(warnSpy).toHaveBeenCalledWith('Please enable notifications')

    window.Notification = originalNotification
    warnSpy.mockRestore()
  })

  it('shows and closes a notification once permission is granted', () => {
    const close = vi.fn()
    class NotificationMock {
      static permission: NotificationPermission = 'default'
      static requestPermission = vi.fn(
        (callback?: (permission: NotificationPermission) => void) => {
          callback?.('granted')
          return Promise.resolve('granted' as NotificationPermission)
        },
      )
      close = close
      constructor(
        public title: string,
        public options?: NotificationOptions,
      ) {}
    }

    const originalNotification = window.Notification
    window.Notification = NotificationMock as unknown as typeof Notification

    notify('alice', 'hello there')

    expect(close).toHaveBeenCalled()

    window.Notification = originalNotification
  })
})
