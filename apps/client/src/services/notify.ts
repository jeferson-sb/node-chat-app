const showNotification = (
  permission: NotificationPermission,
  user: string,
  message: string,
): void => {
  if (permission === 'granted') {
    const notification = new Notification(user, {
      body: message,
    });
    notification.close();
  }
};

const notify = (user: string, message: string): void => {
  if (window.Notification && Notification.permission !== 'denied') {
    Notification.requestPermission((permission) => {
      showNotification(permission, user, message);
    });
  } else {
    console.warn('Please enable notifications');
  }
};

export default notify;
