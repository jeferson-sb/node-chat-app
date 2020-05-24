const process = (permission, user, message) => {
  if (permission === 'granted') {
    let n = new Notification(user, {
      body: message
    })
    n.close()
  }
}

const notify = (user, message) => {
  if (window.Notification && Notification.permission !== 'denied') {
    Notification.requestPermission(permission => {
      process(permission, user, message)
    })
  } else {
    console.warn('Please enable notifications')
  }
}

export default notify
