export const eventTypes = {
  join: 'join',
  message: 'message',
  error: 'error',
  roomData: 'roomData',
  history: 'history',
  // Emitted only to the joining socket, never broadcast to the room - a
  // private room's access code is only meaningful to the person who just
  // proved they either created or already know it (Task 12).
  privateRoomCode: 'privateRoomCode',
} as const;

export type EventType = (typeof eventTypes)[keyof typeof eventTypes];
