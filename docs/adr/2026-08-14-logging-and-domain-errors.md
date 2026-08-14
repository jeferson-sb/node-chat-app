# Structured logging (Pino) and typed domain errors surfaced over Socket.io

- Status: Accepted
- Date: 2026-08-13

## Context

Every log line in the server was a plain `console.log`/`console.error`
call (`createApp.ts`, `SocketController.ts`, `server.ts`,
`gracefulShutdown.ts`, `socketAuth.ts`, `MessagePersistenceConsumer.ts`,
`bootstrap.ts`). That's fine for a single local process, but this app now
runs multiple server replicas behind Nginx
(docs/adr/2026-08-09-horizontal-scaling.md) - once those processes'
stdout is interleaved (e.g. `docker compose logs`, a log aggregator), a
plain-text line like `[socket]: disconnected: abc123` has no level, no
structured fields to filter/correlate on (which socket, which room), and
no way to tell which of several replicas emitted it.

Separately, `SocketController` had two failure paths with no real
signal to the client:
- `onJoinRoom` only `console.error`'d a missing `room` and then kept
  going, joining the socket to `undefined`.
- `onSendMessage` silently did nothing when the sender had no active
  room membership (e.g. `sendMessage` fired before a successful `join`),
  giving the client no indication their message was dropped.

And every socket event handler was wrapped in `.catch(console.error)` at
its `socket.on(...)` registration (`createApp.ts`) - any rejection,
expected or not, was logged server-side and the client never learned
anything went wrong. `HTTPError` (`infra/errors/HTTPError.ts`) already
solved the equivalent problem for the Express side (a typed error mapped
to a status code + JSON body by a central error-handling middleware);
Socket.io had no counterpart.

## Decision

**Adopt Pino for structured logging, and introduce a small `DomainError`
hierarchy (`ValidationError`, `RoomNotFoundError`) that a new
`handleSocketEvent` wrapper turns into a client-facing `error` socket
event, mirroring `HTTPError`'s role on the HTTP side.**

### Logging

`infra/logging/createLogger.ts` exports a single shared `logger`
(mirroring `createRedisClient.ts`'s role for ioredis): structured JSON in
production (one line per log, `level`/`time`/arbitrary fields), pretty-
printed via `pino-pretty` in development for local readability. Level is
`LOG_LEVEL` (default `info`). Every `console.*` call in the server was
replaced with a `logger.info`/`logger.warn`/`logger.error` call carrying
relevant fields (`socketId`, `err`, `code`, ...) instead of interpolating
them into a message string - `no-console` stays off in `.oxlintrc.json`
mode `off` today only because no console usage remains to flag; leaving
it on would help catch a stray `console.*` slipping back in later, but
that's a separate follow-up, not blocking this change.

### Domain errors

`domain/errors/DomainError.ts` is an abstract base (`message` + a stable
`code` string) that `ValidationError` and `RoomNotFoundError` extend:
- `ValidationError` - caller-supplied input fails a domain invariant.
  `Message.from()`'s over-length check (previously a plain `Error`) and
  `SocketController.onJoinRoom`'s missing-`room` check (previously a
  `console.error` that didn't stop execution) both now throw this.
- `RoomNotFoundError` - `onSendMessage` now throws this instead of
  silently no-op'ing when the sender has no active room membership.

`presentation/handleSocketEvent.ts` wraps a handler call: a `DomainError`
becomes a `logger.warn` (expected, client-caused) plus an `error` socket
event carrying `{ code, message }`; anything else becomes a
`logger.error` (unexpected) and the client only gets a generic `{ code:
'INTERNAL_ERROR', message: '...' }` - never a raw internal error string,
same principle as the Express error-handling middleware's `HTTPError`
vs.-generic-500 split. `createApp.ts`'s `socket.on(...)` registrations
now call `handleSocketEvent(socket, () => controller.onXxx(...))` instead
of `.catch(console.error)`.

## Consequences

- Every server log line is now structured (JSON in production), with a
  `socketId` (and, where relevant, `err`/`code`) field instead of being
  baked into a message string - filterable/correlatable across replicas
  in a log aggregator, which plain `console.*` output couldn't be.
- Clients now receive an actual `error` event for both the missing-room
  and no-active-membership cases, instead of the request silently doing
  nothing or the wrong thing. The client (`Chat.vue`) doesn't yet listen
  for `error` - that's tracked as follow-up work, not part of this
  change, since the server-side contract needed to exist first.
- `SocketController.onSendMessage`'s behavior changed: a message from a
  sender with no active room membership now rejects with
  `RoomNotFoundError` instead of resolving successfully having done
  nothing - `SocketController.test.ts`'s "does nothing when the sender
  is not a known user" test was updated to assert the throw instead.
- `Message.from()`'s over-length rejection is now a `ValidationError`
  instead of a plain `Error` - `instanceof Error` still holds (existing
  `.rejects.toThrow('...')` message-based assertions keep passing
  unchanged), only code that specifically checks `instanceof Error` vs.
  `instanceof ValidationError` needs to care about the distinction.
- One new runtime dependency (`pino`) plus a dev-only `pino-pretty` for
  local formatting - justified per AGENTS.md's "don't add dependencies
  without justification" by the horizontal-scaling correlation problem
  above, which `console.*` structurally cannot solve.
- `DomainError` is abstract with only two subclasses so far - deliberately
  minimal (no error-code enum, no HTTP-status mapping) since the two
  concrete cases don't need more; extend with a new subclass per new
  business-rule failure as they come up, rather than generalizing ahead
  of a second real use case.

## Alternatives considered

- **Keep `console.*` but prefix every message with a consistent tag**:
  doesn't solve the actual problem - still unstructured text, still no
  way to filter/query by field in a log aggregator, just a marginally
  more consistent string to grep for.
- **A heavier logging library or built-in OpenTelemetry-style tracing**:
  this app has no distributed-tracing need yet (no multi-service request
  fan-out beyond the socket/HTTP boundary) - Pino's structured JSON lines
  are enough to correlate by `socketId`/room across replicas; adopting
  full tracing now would be solving a problem this app doesn't have.
- **A single generic `SocketError` class instead of a `DomainError`
  hierarchy**: would still let `handleSocketEvent` distinguish "expected,
  tell the client" from "unexpected, log and hide the details", but loses
  the ability for callers to `instanceof`-check a *specific* failure
  (e.g. a future feature reacting differently to `RoomNotFoundError` than
  to `ValidationError`) without inspecting `.code` strings instead of the
  type system. Rejected in favor of the small hierarchy, which costs
  little given there are only two cases today.
- **Map `DomainError` subclasses to specific HTTP-style codes reused from
  `HTTPError`**: Socket.io's `error` event isn't a response with a status
  code - inventing one to reuse `HTTPError`'s `statusCode` field would
  just be a translation layer with no real client (there's no HTTP
  status to set) for no benefit over `DomainError`'s own `code` string.
