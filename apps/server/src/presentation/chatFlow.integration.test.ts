import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { createApp, type App } from './createApp.ts';
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
 * protocol (join -> receive welcome/roomData -> send/receive a message ->
 * disconnect -> the other participant is notified and roomData updates).
 * Unlike SocketController.test.ts (which mocks the socket.io Server/Socket
 * to unit-test the controller's branching logic in isolation), this spins
 * up a real HTTP + socket.io server on an ephemeral port and connects real
 * socket.io-client instances, to guard against regressions in the actual
 * event wiring in createApp.ts.
 */
describe('chat flow (integration)', () => {
  let app: App;
  let baseUrl: string;
  const clients: ClientSocket[] = [];

  beforeAll(async () => {
    app = createApp();
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

  const connect = (): Promise<ClientSocket> => {
    const client = ioClient(baseUrl, {
      forceNew: true,
      transports: ['websocket'],
    });
    clients.push(client);
    return new Promise((resolve) =>
      client.on('connect', () => resolve(client)),
    );
  };

  const waitForEvent = <T>(socket: ClientSocket, event: string): Promise<T> =>
    new Promise((resolve) => socket.once(event, resolve));

  it('welcomes a joining user and broadcasts roomData', async () => {
    const alice = await connect();

    const welcomePromise = waitForEvent<ChatMessage>(alice, eventTypes.message);
    const roomDataPromise = waitForEvent<RoomData>(alice, eventTypes.roomData);
    alice.emit(eventTypes.join, { username: 'alice', room: 'general' });

    const welcome = await welcomePromise;
    const roomData = await roomDataPromise;

    expect(welcome.username).toBe('Admin');
    expect(welcome.text).toContain('alice');
    expect(roomData.users).toEqual([
      { username: 'alice', room: 'general', socketId: alice.id },
    ]);
  });

  it('notifies existing room members when someone else joins', async () => {
    const alice = await connect();
    alice.emit(eventTypes.join, { username: 'alice', room: 'general' });
    await waitForEvent(alice, eventTypes.roomData);

    const bob = await connect();
    const aliceNotified = waitForEvent<ChatMessage>(alice, eventTypes.message);
    bob.emit(eventTypes.join, { username: 'bob', room: 'general' });

    const joinMessage = await aliceNotified;
    expect(joinMessage.username).toBe('Server');
    expect(joinMessage.text).toBe('bob has joined the chat!');
  });

  it('delivers a sent message to everyone in the room', async () => {
    const alice = await connect();
    alice.emit(eventTypes.join, { username: 'alice', room: 'general' });
    await waitForEvent(alice, eventTypes.roomData);

    const bob = await connect();
    bob.emit(eventTypes.join, { username: 'bob', room: 'general' });
    await waitForEvent(bob, eventTypes.roomData);
    await waitForEvent(alice, eventTypes.message); // consume bob's join notice

    const bobReceives = waitForEvent<ChatMessage>(bob, eventTypes.message);
    alice.emit('sendMessage', {
      username: 'alice',
      message: 'hello bob',
    });

    const received = await bobReceives;
    expect(received).toMatchObject({ username: 'alice', text: 'hello bob' });
  });

  it('notifies the room and updates roomData when a user disconnects', async () => {
    const alice = await connect();
    alice.emit(eventTypes.join, { username: 'alice', room: 'general' });
    await waitForEvent(alice, eventTypes.roomData);

    const bob = await connect();
    bob.emit(eventTypes.join, { username: 'bob', room: 'general' });
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
  });
});
