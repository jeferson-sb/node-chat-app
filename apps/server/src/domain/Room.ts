import { randomInt } from 'node:crypto';

export type RoomVisibility = 'public' | 'private';

/**
 * A room's visibility/access-code settings, decided once at creation
 * (the first join for that room name) and immutable afterwards - a later
 * joiner's requested visibility is ignored once a room already has a
 * config (see RoomRepository.getOrCreateRoomConfig). `code` is only ever
 * set when `visibility` is `'private'` (Task 12).
 */
export type RoomConfig = {
  room: string;
  visibility: RoomVisibility;
  code?: string;
};

/**
 * Result of RoomRepository.getOrCreateRoomConfig: the config that's now
 * authoritative for the room, plus whether this call is what created it.
 * `created` matters to SocketController.onJoinRoom - the socket that just
 * created a private room can't possibly know its code yet, so it must
 * skip the code check that every later joiner is held to.
 */
export type RoomConfigLookup = {
  config: RoomConfig;
  created: boolean;
};

const ROOM_CODE_LENGTH = 6;

/**
 * Generates a random 6-digit access code for a newly created private
 * room. Zero-padded so it's always exactly 6 digits (e.g. "004829"),
 * matching the 6-digit code described in docs/TASK_TRACKER.md Task 12.
 * Uses a CSPRNG because the code is an access-control credential and
 * creators are shown their own code: Math.random would let a caller farm
 * outputs from the shared PRNG stream and derive other rooms' codes.
 */
export const generateRoomCode = (): string =>
  randomInt(0, 10 ** ROOM_CODE_LENGTH)
    .toString()
    .padStart(ROOM_CODE_LENGTH, '0');
