# Extract service instantiation into a bootstrap composition root

- Status: Accepted
- Date: 2026-08-12

## Context

`createApp.ts` (`apps/server/src/presentation/createApp.ts`) mixed two
different concerns in one 292-line function: instantiating every backing
service (`RoomRepository`, the auth database, `MessageHistoryRepository`,
`MessageQueue` - each with its own real-vs-in-memory fallback logic and
`close()`), and wiring the Express app + Socket.io server that actually
uses them. `docs/TASK_TRACKER.md` Task 6 asks for these to be separated,
via dependency injection, for easier testing/maintenance.

The only existing test injection seam was `CreateAppDeps.authDatabase`
(used by `auth.integration.test.ts`/`chatFlow.integration.test.ts` to run
against an in-process pglite database instead of real Postgres) - `rooms`,
`messageHistory`, and `messageQueue` could only ever resolve from
`config`/env inside `createApp.ts` itself, with no way to override them
in a test.

## Decision

**Extract service instantiation into a new `apps/server/src/bootstrap.ts`,
manually composed (no DI container library)** - consistent with
AGENTS.md's "don't add dependencies without justification": this app's
entire service graph is four services with static, config-driven
fallback logic (real store vs. in-memory), which a plain function already
expresses clearly without a container's runtime resolution/decorators.

`bootstrap(deps: BootstrapDeps): Services` resolves each service either
from the given override or from its real, `config`/env-driven default -
same fallback behavior each service already had, just extracted into its
own `resolveX` function (`resolveRooms`, `resolveAuthDatabase`,
`resolveMessageHistory`, `resolveMessageQueue`) instead of being inlined
in `createApp`. `BootstrapDeps` widens the old `authDatabase`-only seam to
also accept `rooms`/`messageHistory`/`messageQueue` overrides, so tests
aren't limited to only faking the database.

`createApp.ts` now just calls `bootstrap(deps)` once and wires the
resolved services into Express/Socket.io - it no longer knows how any
service is constructed or torn down. `CreateAppDeps` is now just an alias
for `BootstrapDeps`, so `createApp`'s public API is unchanged for existing
callers (`auth.integration.test.ts`/`chatFlow.integration.test.ts` still
pass `{ authDatabase }` untouched).

## Consequences

- `createApp.ts` shrank from 292 to 117 lines; it now reads as "wire
  these already-resolved services into an HTTP/Socket.io app", not
  "construct four services, then wire them".
- `bootstrap.ts` is unit-testable independently of Express/Socket.io
  (`bootstrap.test.ts`): default in-memory fallback, the
  `DATABASE_URL`-missing failure, and override passthrough are now
  covered without spinning up a real HTTP server.
- Tests gained the ability to override `rooms`/`messageHistory`/
  `messageQueue` the same way `authDatabase` already could, though no
  existing test needed this yet - it's available for a future test that
  wants to fake, say, a slow `MessageHistoryRepository` without a real
  Scylla/Redis dependency.
- No DI container/library was introduced. If the service graph grows
  significantly more complex (conditional wiring depending on more than
  "is this env var set", or services depending on many siblings), revisit
  whether manual composition still reads clearly, per this decision.

## Alternatives considered

- **A DI container library (e.g. awilix, tsyringe)**: would automate
  wiring/lifecycle management, but this app's service graph is four
  services with simple, static fallback logic - a container's runtime
  resolution and decorators/metadata would add a new dependency and a new
  concept to learn for no real gain over the plain functions this ADR
  lands on. Rejected per AGENTS.md's "don't add dependencies without
  justification".
- **Leave instantiation inline in `createApp.ts`, just extract to more
  local functions**: doesn't solve the actual problem - those functions
  were already there (`setupRooms`, `setupAuthDatabase`, etc.), just
  private to `createApp.ts` and untestable on their own, with no way for
  a test to override anything but `authDatabase`.
