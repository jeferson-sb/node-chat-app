import { DomainError } from './DomainError.ts';

/**
 * Raised when caller-supplied input fails a domain invariant - e.g. a
 * missing room name on join (SocketController.onJoinRoom) or a message
 * exceeding MAX_TEXT_LENGTH (domain/Message.ts). Distinct from
 * RoomNotFoundError: this is about the shape/content of the input itself,
 * not about a room membership that doesn't exist.
 */
export class ValidationError extends DomainError {
  readonly code = 'VALIDATION_ERROR';
}
