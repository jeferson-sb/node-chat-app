import { describe, expect, it } from 'vitest';
import { ValidationError } from './ValidationError.ts';
import { RoomNotFoundError } from './RoomNotFoundError.ts';
import { InvalidRoomCodeError } from './InvalidRoomCodeError.ts';

describe('ValidationError', () => {
  it('carries a stable code alongside the human-readable message', () => {
    const error = new ValidationError('text too long');

    expect(error.message).toBe('text too long');
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.name).toBe('ValidationError');
  });

  it('is an instance of Error', () => {
    expect(new ValidationError('bad input')).toBeInstanceOf(Error);
  });
});

describe('RoomNotFoundError', () => {
  it('carries a stable code alongside the human-readable message', () => {
    const error = new RoomNotFoundError('no room for this socket');

    expect(error.message).toBe('no room for this socket');
    expect(error.code).toBe('ROOM_NOT_FOUND');
    expect(error.name).toBe('RoomNotFoundError');
  });

  it('is an instance of Error', () => {
    expect(new RoomNotFoundError('missing')).toBeInstanceOf(Error);
  });
});

describe('InvalidRoomCodeError', () => {
  it('carries a stable code alongside the human-readable message', () => {
    const error = new InvalidRoomCodeError(
      'Room "secret" requires an access code',
    );

    expect(error.message).toBe('Room "secret" requires an access code');
    expect(error.code).toBe('INVALID_ROOM_CODE');
    expect(error.name).toBe('InvalidRoomCodeError');
  });

  it('is an instance of Error', () => {
    expect(new InvalidRoomCodeError('bad code')).toBeInstanceOf(Error);
  });
});
