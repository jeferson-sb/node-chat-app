import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { createApp, type App } from './createApp.ts';
import { createTestAuthDatabase } from '../infra/auth/createTestAuthDatabase.ts';
import { eventTypes } from '../utils/eventTypes.ts';
import type { ReadCursorRepository } from '../infra/cursor/ReadCursorRepository.ts';
import { slugifyRoomName } from '../domain/slugifyRoomName.ts';

type ChatMessage = {
  id: string;
  username: string;
  text: string;
  createdAt: number;
};

type RoomData = {
  room: string;
  users: {
    username: string;
    room: string;
    socketId: string;
    online: boolean;
  }[];
};

/**
 * Characterization test for the chat flow over the real socket.io wire
 * protocol (sign up -> connect (verified via the session cookie, see
 * socketAuth.ts) -> join -> receive welcome/roomData -> send/receive a
 * message -> disconnect -> the other participant is notified and roomData
 * updates). Unlike SocketController.test.ts (which mocks the socket.io
 * Server/Socket to unit-test the controller's branching logic in
 * isolation), this spins up a real HTTP + socket.io server on an
 * ephemeral port and connects real socket.io-client instances, to guard
 * against regressions in the actual event wiring in createApp.ts.
 *
 * Every connection needs a real, signed-up account now (accounts are
 * mandatory - docs/adr/2026-08-09-authentication.md) - signUp() below
 * signs up a fresh user via the real HTTP endpoint and forwards its
 * session cookie as the socket.io-client's Cookie header, since a Node
 * socket.io-client doesn't share a cookie jar with fetch the way a
 * browser would.
 *
 * Known flake: under heavy host CPU load, the two-signup tests below have
 * occasionally timed out waiting for a disconnect notification even at
 * 20s - the client-side `.disconnect()` call's effect on the server was
 * simply delayed, not lost (confirmed via the connect/disconnect logs;
 * InMemoryRoomRepository is synchronous, so it isn't the cause). Passes
 * reliably in isolation or on an otherwise-idle machine.
 *
 * Room roster state is now shared across this whole file (one `app`,
 * built once in beforeAll), and room membership persists across
 * disconnects (docs/adr/2026-08-12-presence-indicators.md) rather than
 * being cleared - so each test that cares about "is this a first-ever
 * join" behavior uses its own unique room name via uniqueRoom() below,
 * to avoid one test's leftover membership silently changing another
 * test's expected first-join outcome.
 */
describe('chat flow (integration)', () => {
  let app: App;
  let baseUrl: string;
  const clients: ClientSocket[] = [];

  beforeAll(async () => {
    const authDatabase = await createTestAuthDatabase();
    // Redis isn't configured for this test run, so bootstrap.ts would
    // otherwise resolve NullReadCursorRepository (offline delivery
    // disabled) - inject a working fake so the offline-delivery test
    // below can exercise the real feature over the wire. Not a shared
    // production class, same reasoning as SocketController.test.ts's own
    // fake (docs/adr/2026-08-14-offline-delivery.md).
    const cursors = new Map<string, number>();
    const readCursors: ReadCursorRepository = {
      getLastSeenAt: async (room, username) =>
        cursors.get(`${room}:${username}`),
      markSeen: async (room, username, seenAt) => {
        cursors.set(`${room}:${username}`, seenAt);
      },
    };
    app = createApp({ authDatabase, readCursors });
    await new Promise<void>((resolve) => app.httpServer.listen(0, resolve));
    const { port } = app.httpServer.address() as AddressInfo;
    baseUrl = `http://localhost:${port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    for (const client of clients.splice(0)) {
      client.disconnect();
    }
  });

  const signUp = async (name: string): Promise<string> => {
    const response = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        email: `${name}-${crypto.randomUUID()}@example.com`,
        password: 'correct-password',
      }),
    });

    return response.headers
      .getSetCookie()
      .map((cookie) => cookie.split(';')[0])
      .join('; ');
  };

  const connectAsUser = async (name: string): Promise<ClientSocket> => {
    const sessionCookie = await signUp(name);
    const client = ioClient(baseUrl, {
      forceNew: true,
      transports: ['websocket'],
      extraHeaders: { Cookie: sessionCookie },
    });
    clients.push(client);
    return new Promise((resolve) =>
      client.on('connect', () => resolve(client)),
    );
  };

  const waitForEvent = <T>(socket: ClientSocket, event: string): Promise<T> =>
    new Promise((resolve) => socket.once(event, resolve));

  const uniqueRoom = (): string => `general-${crypto.randomUUID()}`;

  // The server slugifies the display name sent on `join` before using it
  // as the actual Socket.io room / roster key, appending its own hash
  // suffix on top of whatever uniqueRoom() already looks like (docs/adr/
  // 2026-08-16-room-name-slugs.md) - so assertions against the wire
  // payload's `room` field compare against slugifyRoomName(room), below.

  it('rejects a connection without a valid session', async () => {
    const client = ioClient(baseUrl, {
      forceNew: true,
      transports: ['websocket'],
    });
    clients.push(client);

    const connectError = await new Promise<Error>((resolve) =>
      client.on('connect_error', resolve),
    );

    expect(connectError.message).toBe('Unauthorized');
  });

  it('welcomes a joining user and broadcasts roomData', async () => {
    const room = uniqueRoom();
    const roomSlug = slugifyRoomName(room); // see uniqueRoom()'s doc comment
    const alice = await connectAsUser('alice');

    const welcomePromise = waitForEvent<ChatMessage>(alice, eventTypes.message);
    const roomDataPromise = waitForEvent<RoomData>(alice, eventTypes.roomData);
    alice.emit(eventTypes.join, { room });

    const welcome = await welcomePromise;
    const roomData = await roomDataPromise;

    expect(welcome.username).toBe('Admin');
    expect(welcome.text).toContain('alice');
    expect(roomData.users).toEqual([
      { username: 'alice', room: roomSlug, socketId: alice.id, online: true },
    ]);
  });

  it('notifies existing room members when someone else joins', async () => {
    const room = uniqueRoom();
    const alice = await connectAsUser('alice');
    alice.emit(eventTypes.join, { room });
    await waitForEvent(alice, eventTypes.roomData);

    const bob = await connectAsUser('bob');
    const aliceNotified = waitForEvent<ChatMessage>(alice, eventTypes.message);
    bob.emit(eventTypes.join, { room });

    const joinMessage = await aliceNotified;
    expect(joinMessage.username).toBe('Server');
    expect(joinMessage.text).toBe('bob has joined the chat!');
  }, 20_000); // two real signups (password hashing is CPU-bound) plus the socket round trips push this past vitest's 5s default

  it('delivers a sent message to everyone in the room', async () => {
    const room = uniqueRoom();
    const alice = await connectAsUser('alice');
    alice.emit(eventTypes.join, { room });
    await waitForEvent(alice, eventTypes.roomData);

    const bob = await connectAsUser('bob');
    bob.emit(eventTypes.join, { room });
    await waitForEvent(bob, eventTypes.roomData);
    await waitForEvent(alice, eventTypes.message); // consume bob's join notice

    const bobReceives = waitForEvent<ChatMessage>(bob, eventTypes.message);
    alice.emit('sendMessage', { message: 'hello bob' });

    const received = await bobReceives;
    expect(received).toMatchObject({ username: 'alice', text: 'hello bob' });
  }, 20_000);

  it('marks a disconnected user offline in roomData instead of sending a "has left" message', async () => {
    const room = uniqueRoom();
    const roomSlug = slugifyRoomName(room); // see uniqueRoom()'s doc comment
    const alice = await connectAsUser('alice');
    alice.emit(eventTypes.join, { room });
    await waitForEvent(alice, eventTypes.roomData);

    const bob = await connectAsUser('bob');
    bob.emit(eventTypes.join, { room });
    await waitForEvent(bob, eventTypes.roomData);
    await waitForEvent(alice, eventTypes.message); // consume bob's join notice

    // No "has left" message is ever emitted (docs/adr/2026-08-12-presence-
    // indicators.md) - a message event landing here before roomData would
    // fail this assertion.
    const unexpectedMessage = (msg: ChatMessage) => {
      throw new Error(`unexpected message event: ${JSON.stringify(msg)}`);
    };
    alice.once(eventTypes.message, unexpectedMessage);
    const roomDataUpdated = waitForEvent<RoomData>(alice, eventTypes.roomData);
    bob.disconnect();

    const roomData = await roomDataUpdated;
    alice.off(eventTypes.message, unexpectedMessage);
    expect(roomData.users).toEqual(
      expect.arrayContaining([
        { username: 'alice', room: roomSlug, socketId: alice.id, online: true },
        expect.objectContaining({ username: 'bob', online: false }),
      ]),
    );
  }, 20_000);

  it('does not send a "has joined" message when a returning user rejoins a room', async () => {
    const room = uniqueRoom();
    const roomSlug = slugifyRoomName(room); // see uniqueRoom()'s doc comment
    const alice = await connectAsUser('alice');
    alice.emit(eventTypes.join, { room });
    await waitForEvent(alice, eventTypes.roomData);
    alice.disconnect();

    const aliceAgain = await connectAsUser('alice');
    const unexpectedMessage = (msg: ChatMessage) => {
      throw new Error(`unexpected message event: ${JSON.stringify(msg)}`);
    };
    aliceAgain.once(eventTypes.message, (msg: ChatMessage) => {
      if (msg.username === 'Server') unexpectedMessage(msg);
    });
    const roomDataPromise = waitForEvent<RoomData>(
      aliceAgain,
      eventTypes.roomData,
    );
    aliceAgain.emit(eventTypes.join, { room });

    const roomData = await roomDataPromise;
    expect(roomData.users).toEqual([
      {
        username: 'alice',
        room: roomSlug,
        socketId: aliceAgain.id,
        online: true,
      },
    ]);
  }, 20_000);

  it('delivers messages sent while a user was offline, on reconnect', async () => {
    const room = uniqueRoom();
    const alice = await connectAsUser('alice');
    alice.emit(eventTypes.join, { room });
    await waitForEvent(alice, eventTypes.roomData);

    const bob = await connectAsUser('bob');
    bob.emit(eventTypes.join, { room });
    await waitForEvent(bob, eventTypes.roomData);
    await waitForEvent(alice, eventTypes.message); // consume bob's join notice

    const bobSeesAliceOffline = waitForEvent<RoomData>(
      bob,
      eventTypes.roomData,
    );
    alice.disconnect();
    await bobSeesAliceOffline;

    const bobReceivesOwnBroadcast = waitForEvent<ChatMessage>(
      bob,
      eventTypes.message,
    );
    bob.emit('sendMessage', { message: 'missed while offline' });
    await bobReceivesOwnBroadcast;

    const aliceAgain = await connectAsUser('alice');
    const historyPromise = waitForEvent<ChatMessage[]>(
      aliceAgain,
      eventTypes.history,
    );
    aliceAgain.emit(eventTypes.join, { room });

    const history = await historyPromise;
    expect(history).toEqual([
      expect.objectContaining({
        username: 'bob',
        text: 'missed while offline',
      }),
    ]);
  }, 20_000);

  // Counterpart to the test above: reconnecting having missed *nothing*
  // must still show the room's history
  // (docs/adr/2026-08-15-history-snapshot-on-join.md).
  it('still shows a reconnecting user the messages they sent before leaving', async () => {
    const room = uniqueRoom();
    const alice = await connectAsUser('alice');
    alice.emit(eventTypes.join, { room });
    await waitForEvent(alice, eventTypes.roomData);

    const ownBroadcast = waitForEvent<ChatMessage>(alice, eventTypes.message);
    alice.emit('sendMessage', { message: 'still here after a refresh' });
    await ownBroadcast;

    alice.disconnect();

    const aliceAgain = await connectAsUser('alice');
    const historyPromise = waitForEvent<ChatMessage[]>(
      aliceAgain,
      eventTypes.history,
    );
    aliceAgain.emit(eventTypes.join, { room });

    expect(await historyPromise).toEqual([
      expect.objectContaining({
        username: 'alice',
        text: 'still here after a refresh',
      }),
    ]);
  }, 20_000);
});
