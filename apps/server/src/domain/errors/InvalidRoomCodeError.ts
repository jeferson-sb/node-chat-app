import { DomainError } from './DomainError.ts';

/**
 * Raised when joining a private room without the matching 6-digit access
 * code - either none was supplied, or it doesn't match the code
 * generated when the room was created (SocketController.onJoinRoom, Task
 * 12). Code validation only ever happens server-side, against the
 * RoomConfig persisted by RoomRepository.getOrCreateRoomConfig - the
 * client's own `code`/`visibility` input is never trusted on its own.
 */
export class InvalidRoomCodeError extends DomainError {
  readonly code = 'INVALID_ROOM_CODE';
}
