export const eventTypes = {
  join: 'join',
  message: 'message',
  error: 'error',
  roomData: 'roomData',
  history: 'history',
} as const;

export type EventType = (typeof eventTypes)[keyof typeof eventTypes];
