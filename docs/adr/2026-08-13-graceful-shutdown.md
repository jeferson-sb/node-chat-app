# Graceful shutdown: drain Socket.io connections, close backing services, force-exit fallback

- Status: Accepted
- Date: 2026-08-13

## Context

`server.ts` already listened for `SIGINT`/`SIGTERM` and called `httpServer.close()` then `close()` (bootstrap.ts's aggregated teardown of Redis/Postgres/Scylla connections) before `process.exit(0)`. This looked like graceful shutdown but had real gaps:

- `httpServer.close()`'s callback wasn't used, so `close()` ran without waiting for existing HTTP connections to actually finish draining.
- Nothing closed open **Socket.io** connections. Socket.io keeps its own long-lived WebSocket connections independent of the HTTP server's own connection tracking, so `httpServer.close()` alone doesn't touch them - on `docker compose stop`/`SIGTERM`, every connected chat client would simply have its connection cut when the process exits, with no server-side notice.
- No timeout/force-exit fallback: if `close()` ever hung (e.g. a stuck Redis/Postgres connection during teardown), the process would never exit.
- None of this was under test - it lived directly in the entrypoint (`server.ts`).

This matters more here than in a typical HTTP API because the app's core feature is long-lived WebSocket connections, not request/response.

## Decision

**Fold `socketServer.close()` into `createApp.ts`'s aggregated `close()`, and extract signal handling + a force-exit timeout into a new, unit-tested `gracefulShutdown.ts`.**

`socket.io`'s own `Server.close()` already does exactly what's needed in one call: force-disconnects every open socket (each client gets a `disconnect` event, "server shutting down"), closes the Redis adapter if one is attached, and closes the underlying `httpServer` itself (with its own close-callback awaited internally). `createApp.ts`'s `close` now runs `await socketServer.close()` first, then `await close()` (bootstrap's backing-service teardown) - sequential, not concurrent, so Redis/Postgres/Scylla aren't torn down while a socket/request handler might still be mid-flight against them.

`gracefulShutdown.ts` (`registerGracefulShutdown(close, options)`) wires `SIGINT`/`SIGTERM` to `close()`, with:
- A `forceExitAfterMs` timeout (default 10s) that force-exits with code 1 and an error log if `close()` never resolves.
- Guard against a second signal restarting teardown while already shutting down (a process manager sending `SIGTERM` then `SIGKILL` shortly after, or a user hitting Ctrl+C twice, shouldn't run `close()` concurrently with itself).
- A `process` injection seam (`Pick<NodeJS.Process, 'on' | 'exit'>`) so it's testable without touching the real process (`gracefulShutdown.test.ts`).

`server.ts` shrinks to `registerGracefulShutdown(close)` - no more inline shutdown logic in the entrypoint.

## Consequences

- Connected clients now get a real `disconnect` event ("server shutting down") on deploy/restart instead of the connection just dying - `socket.io-client`'s default reconnection logic can react to this immediately rather than only noticing after a missed heartbeat.
- A hung backing-service teardown no longer means an unkillable process - it force-exits after `forceExitAfterMs`, matching how orchestrators (Kubernetes, Docker) already expect a container to either stop within its own grace period or be force-killed anyway; this just makes the app force-exit itself with a clear log instead of relying entirely on the platform's forced `SIGKILL`.
- `gracefulShutdown.ts` is unit-tested in isolation (signal → close → exit code; close() rejects → exit 1; timeout → forced exit 1; duplicate signal ignored) without spinning up a real server or sending real OS signals.
- The two integration tests that manually called `app.httpServer.close()` before `app.close()` had that first call removed - now redundant since `close()` closes the HTTP server itself via `socketServer.close()`.
- Socket.io's `close()` disconnects every socket immediately with no grace period for in-flight work to finish on the client side - acceptable for this app (chat messages aren't multi-step transactions), but worth naming as a real trade-off if a future feature needs "let clients finish, then disconnect" instead.

## Alternatives considered

- **Manually iterate `socketServer.sockets` and call `.disconnect()` on each**: functionally close to what `Server.close()` already does internally, but reimplements logic the library provides directly (including handling the Redis adapter and the HTTP server together) - no reason to duplicate it.
- **A longer grace period allowing in-flight socket events to finish before disconnecting**: `sendMessage`/`join` handlers are all short-lived (broadcast + enqueue, not held open), so there's nothing meaningfully "in-flight" per socket to wait for beyond what `close()` already waits for at the request/service level. Rejected as unnecessary complexity for this app's actual handler shapes.
