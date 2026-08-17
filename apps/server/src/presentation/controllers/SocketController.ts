import type { Server, Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';

import type { ChatUser } from '../../domain/ChatUser.ts';
import { Message, type MessageSnapshot } from '../../domain/Message.ts';
import { generateRoomCode, type RoomVisibility } from '../../domain/Room.ts';
import { slugifyRoomName } from '../../domain/slugifyRoomName.ts';
import { mergeHistory } from './mergeHistory.ts';
import { ValidationError } from '../../domain/errors/ValidationError.ts';
import { RoomNotFoundError } from '../../domain/errors/RoomNotFoundError.ts';
import { InvalidRoomCodeError } from '../../domain/errors/InvalidRoomCodeError.ts';
import { eventTypes } from '../../utils/eventTypes.ts';
import type { RoomRepository } from '../../infra/rooms/RoomRepository.ts';
import type { MessageHistoryRepository } from '../../infra/history/MessageHistoryRepository.ts';
import type { MessageQueue } from '../../infra/queue/MessageQueue.ts';
import type { ReadCursorRepository } from '../../infra/cursor/ReadCursorRepository.ts';
import { getSocketUser } from '../socketAuth.ts';
import { logger } from '../../infra/logging/createLogger.ts';

export type { ChatUser };

export type JoinRoomPayload = {
  /**
   * The room's display name as the client typed/knows it (e.g. "CS Study
   * Group") - not yet a storage key. `onJoinRoom` slugifies this into the
   * ASCII, URL-safe name (see slugifyRoomName.ts) actually used as the
   * Socket.io room and as the key for the room roster, message history,
   * and read cursors, so those internal services never have to deal with
   * whitespace/casing/unicode variance in a user-chosen name (docs/adr/
   * 2026-08-16-room-name-slugs.md).
   */
  room: string;
  /**
   * Client's requested visibility for a room that doesn't exist yet.
   * Only takes effect on the room's first-ever join - see
   * RoomRepository.getOrCreateRoomConfig. Defaults to `'public'`, so
   * omitting this field preserves today's implicit-creation behavior.
   */
  visibility?: RoomVisibility;
  /** Access code for an existing private room. Ignored for public rooms. */
  code?: string;
};

export type PrivateRoomCodePayload = {
  room: string;
  code: string;
};

export type SendMessagePayload = {
  message: string;
};

export type SocketControllerDeps = {
  socketServer: Server;
  rooms: RoomRepository;
  messageHistory: MessageHistoryRepository;
  messageQueue: MessageQueue;
  readCursors: ReadCursorRepository;
};

/** How many past messages a joining user sees (docs/adr/2026-08-11-chat-history-storage.md). */
const HISTORY_LIMIT = 50;

export default class SocketController {
  private readonly socketServer: Server;
  private readonly rooms: RoomRepository;
  private readonly messageHistory: MessageHistoryRepository;
  private readonly messageQueue: MessageQueue;
  private readonly readCursors: ReadCursorRepository;

  constructor({
    socketServer,
    rooms,
    messageHistory,
    messageQueue,
    readCursors,
  }: SocketControllerDeps) {
    this.socketServer = socketServer;
    this.rooms = rooms;
    this.messageHistory = messageHistory;
    this.messageQueue = messageQueue;
    this.readCursors = readCursors;
  }

  async onJoinRoom(
    socket: Socket,
    { room, visibility = 'public', code }: JoinRoomPayload,
  ): Promise<void> {
    if (!room || room.trim().length === 0) {
      throw new ValidationError('Room is required');
    }

    // Everything downstream (Socket.io room, roster, history, cursors,
    // visibility config) keys off the slug, never the raw display name a
    // client sent - see JoinRoomPayload's doc comment and
    // docs/adr/2026-08-16-room-name-slugs.md.
    const slug = slugifyRoomName(room);

    // Claims this room's visibility if nobody has yet; a room that
    // already exists ignores the requested visibility and returns its
    // real config instead (docs/adr/2026-08-16-private-rooms.md). The
    // code is generated even when it might go unused (the room may
    // already exist) - same "generate first, discard if unused" shape as
    // uuidv4() below for message ids.
    const { config: roomConfig, created } =
      await this.rooms.getOrCreateRoomConfig({
        room: slug,
        visibility,
        code: visibility === 'private' ? generateRoomCode() : undefined,
      });

    // A brand-new private room has no code for its creator to have
    // supplied yet - only a later joiner against an already-existing
    // room is held to the code check.
    if (
      !created &&
      roomConfig.visibility === 'private' &&
      roomConfig.code !== code
    ) {
      // Errors quote the display name, not the slug: it's what the user
      // typed and the only form they recognise.
      throw new InvalidRoomCodeError(
        code
          ? `Invalid access code for room "${room}"`
          : `Room "${room}" requires an access code`,
      );
    }

    if (roomConfig.visibility === 'private' && roomConfig.code) {
      // Sent only to this socket, never broadcast: harmless to echo the
      // code back to a joiner who supplied it correctly (they already
      // know it), and it's how a room's creator learns the code to share
      // in the first place - there's no other channel to deliver it on.
      socket.emit(eventTypes.privateRoomCode, {
        room: slug,
        code: roomConfig.code,
      } satisfies PrivateRoomCodePayload);
    }

    // No "username already in use" check here: the username now comes
    // from a verified account (socketAuth.ts), not client input, so the
    // account itself - not this check - is what makes it unique (see
    // docs/adr/2026-08-09-authentication.md).
    const { name: username } = getSocketUser(socket);
    const isFirstJoin = await this.rooms.addUser({
      username,
      room: slug,
      socketId: socket.id,
      online: true,
    });

    socket.join(slug);

    // `history` is a snapshot, not a delta - the client assigns it over
    // its whole transcript (docs/adr/2026-08-15-history-snapshot-on-join.md).
    const lastSeenAt = await this.readCursors.getLastSeenAt(slug, username);
    const [recent, missed] = await Promise.all([
      this.messageHistory.getRecentMessages(slug, HISTORY_LIMIT),
      lastSeenAt === undefined
        ? Promise.resolve<MessageSnapshot[]>([])
        : this.messageHistory.getMessagesSince(slug, lastSeenAt, HISTORY_LIMIT),
    ]);
    const history = mergeHistory(recent, missed, HISTORY_LIMIT);
    socket.emit(eventTypes.history, history.slice().reverse());

    // Forward only: the recent window reaches back past the cursor, so
    // the newest delivered message may be one already seen.
    const [newestDelivered] = history;
    if (newestDelivered && newestDelivered.createdAt > (lastSeenAt ?? 0)) {
      await this.readCursors.markSeen(
        slug,
        username,
        newestDelivered.createdAt,
      );
    }

    const welcomeMessage = Message.from({
      id: uuidv4(),
      username: 'Admin',
      text: `Hello ${username}, Welcome to the chat!`,
      createdAt: Date.now(),
    });
    socket.emit(eventTypes.message, welcomeMessage.snapshot());

    // Only the user's first-ever join to this room gets a "has joined"
    // message; a returning user is reflected purely via the online
    // indicator in roomData below (docs/adr/2026-08-12-presence-indicators.md).
    if (isFirstJoin) {
      const joinMessage = Message.from({
        id: uuidv4(),
        username: 'Server',
        text: `${username} has joined the chat!`,
        createdAt: Date.now(),
      });
      socket.to(slug).emit(eventTypes.message, joinMessage.snapshot());
    }

    this.socketServer.to(slug).emit(eventTypes.roomData, {
      room: slug,
      users: await this.getUsersOnRoom(slug),
    });
  }

  async onSendMessage(
    socket: Socket,
    { message }: SendMessagePayload,
  ): Promise<void> {
    const { name: username } = getSocketUser(socket);
    const user = await this.rooms.findUserByUsername(username);

    if (!user) {
      throw new RoomNotFoundError(
        `${username} has no active room membership to send a message to`,
      );
    }

    const msg = Message.from({
      id: uuidv4(),
      username,
      text: message,
      createdAt: Date.now(),
    });

    // Broadcast first: real-time delivery must not wait on, or fail
    // because of, history persistence (docs/adr/2026-08-11-message-
    // queue-persistence.md) - enqueueing is buffered/retried by the
    // queue, unlike a direct write that fails outright.
    this.socketServer.to(user.room).emit(eventTypes.message, msg.snapshot());
    await this.messageQueue.enqueue(user.room, msg.snapshot());
  }

  async onDisconnect(socket: Socket): Promise<void> {
    // No "has left" message: a disconnect only flips the sidebar's
    // online indicator now, see docs/adr/2026-08-12-presence-indicators.md.
    const user = await this.rooms.markUserOffline(socket.id);

    if (user) {
      // Everything broadcast while connected was already seen live, so
      // the cursor advances here too (docs/adr/2026-08-14-offline-delivery.md).
      // A millisecond back: cursors compare strictly, and a message sent
      // in this same millisecond hasn't been seen.
      await this.readCursors.markSeen(user.room, user.username, Date.now() - 1);

      this.socketServer.to(user.room).emit(eventTypes.roomData, {
        room: user.room,
        users: await this.getUsersOnRoom(user.room),
      });
    }

    logger.info({ socketId: socket.id }, 'socket disconnected');
  }

  onConnectionError(socket: Socket): void {
    logger.error({ socketId: socket.id }, 'socket connection error');
  }

  getUsersOnRoom(room: string): Promise<ChatUser[]> {
    return this.rooms.getUsersInRoom(room);
  }
}
