import { DomainError } from './DomainError.ts';

/**
 * Raised when a message can't be routed to a room because the sending
 * socket isn't a tracked member of any room - e.g. `sendMessage` fired
 * before a successful `join` (or after a `RoomRepository` lookup found
 * no matching online membership, see SocketController.onSendMessage).
 * Named after the room rather than the user because what's actually
 * missing, from the caller's perspective, is "which room do I send
 * this to" - the same shape of failure as a lookup miss on any other
 * repository.
 */
export class RoomNotFoundError extends DomainError {
  readonly code = 'ROOM_NOT_FOUND';
}
