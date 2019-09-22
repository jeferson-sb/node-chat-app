const notify = (user, message) => {
  if (window.Notification) {
    Notification.requestPermission(() => {
      const notification = new Notification(`${user} - `, { body: message })
    })
  } else {
    throw new Error('Your browser does not support notifications')
  }
}

export default notify
