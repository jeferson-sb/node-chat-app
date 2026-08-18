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
  // Emitted only to the joining socket, right after `history` - the
  // account's full room-switch list (Task 14,
  // docs/adr/2026-08-17-room-switching.md), not anything to broadcast.
  joinedRooms: 'joinedRooms',
} as const;

export type EventType = (typeof eventTypes)[keyof typeof eventTypes];
