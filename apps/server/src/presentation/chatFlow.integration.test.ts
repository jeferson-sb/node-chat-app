import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { createApp, type App } from './createApp.ts';
import { createTestAuthDatabase } from '../infra/auth/createTestAuthDatabase.ts';
import { eventTypes } from '../utils/eventTypes.ts';

type ChatMessage = {
  id: string;
  username: string;
  text: string;
  createdAt: number;
};

type RoomData = {
  room: string;
  users: { username: string; room: string; socketId: string }[];
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
 */
describe('chat flow (integration)', () => {
  let app: App;
  let baseUrl: string;
  const clients: ClientSocket[] = [];

  beforeAll(async () => {
    const authDatabase = await createTestAuthDatabase();
    app = createApp({ authDatabase });
    await new Promise<void>((resolve) => app.httpServer.listen(0, resolve));
    const { port } = app.httpServer.address() as AddressInfo;
    baseUrl = `http://localhost:${port}`;
  });

  afterAll(async () => {
    app.httpServer.close();
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
    const alice = await connectAsUser('alice');

    const welcomePromise = waitForEvent<ChatMessage>(alice, eventTypes.message);
    const roomDataPromise = waitForEvent<RoomData>(alice, eventTypes.roomData);
    alice.emit(eventTypes.join, { room: 'general' });

    const welcome = await welcomePromise;
    const roomData = await roomDataPromise;

    expect(welcome.username).toBe('Admin');
    expect(welcome.text).toContain('alice');
    expect(roomData.users).toEqual([
      { username: 'alice', room: 'general', socketId: alice.id },
    ]);
  });

  it('notifies existing room members when someone else joins', async () => {
    const alice = await connectAsUser('alice');
    alice.emit(eventTypes.join, { room: 'general' });
    await waitForEvent(alice, eventTypes.roomData);

    const bob = await connectAsUser('bob');
    const aliceNotified = waitForEvent<ChatMessage>(alice, eventTypes.message);
    bob.emit(eventTypes.join, { room: 'general' });

    const joinMessage = await aliceNotified;
    expect(joinMessage.username).toBe('Server');
    expect(joinMessage.text).toBe('bob has joined the chat!');
  }, // Two real signups (password hashing is CPU-bound) plus the socket
  // round trips push this past vitest's 5s default.
  20_000);

  it('delivers a sent message to everyone in the room', async () => {
    const alice = await connectAsUser('alice');
    alice.emit(eventTypes.join, { room: 'general' });
    await waitForEvent(alice, eventTypes.roomData);

    const bob = await connectAsUser('bob');
    bob.emit(eventTypes.join, { room: 'general' });
    await waitForEvent(bob, eventTypes.roomData);
    await waitForEvent(alice, eventTypes.message); // consume bob's join notice

    const bobReceives = waitForEvent<ChatMessage>(bob, eventTypes.message);
    alice.emit('sendMessage', { message: 'hello bob' });

    const received = await bobReceives;
    expect(received).toMatchObject({ username: 'alice', text: 'hello bob' });
  }, 20_000);

  it('notifies the room and updates roomData when a user disconnects', async () => {
    const alice = await connectAsUser('alice');
    alice.emit(eventTypes.join, { room: 'general' });
    await waitForEvent(alice, eventTypes.roomData);

    const bob = await connectAsUser('bob');
    bob.emit(eventTypes.join, { room: 'general' });
    await waitForEvent(bob, eventTypes.roomData);
    await waitForEvent(alice, eventTypes.message); // consume bob's join notice

    const aliceNotified = waitForEvent<ChatMessage>(alice, eventTypes.message);
    const roomDataUpdated = waitForEvent<RoomData>(alice, eventTypes.roomData);
    bob.disconnect();

    const leaveMessage = await aliceNotified;
    const roomData = await roomDataUpdated;
    expect(leaveMessage.text).toBe('bob has left the chat!');
    expect(roomData.users).toEqual([
      { username: 'alice', room: 'general', socketId: alice.id },
    ]);
  }, 20_000);
});
