# Modernize the ChatMe stack

- Status: Accepted
- Date: 2026-08-09

## Context

ChatMe is a legacy Node.js + Express + Socket.io chat app with a separate
Vue 2.7 client built with Vite. It is functionally solid but has accumulated
tooling and dependency debt:

- Root and client are two independently-installed npm/pnpm packages with no
  workspace wiring, despite both having `pnpm-lock.yaml` files.
- The whole codebase (server and client) is plain JavaScript with no type
  checking.
- The client runs on Vue 2.7, which is in maintenance mode.
- Linting/formatting is handled by eslint + prettier, duplicated in both
  packages.
- There are no automated tests anywhere in the repo (Jest is listed as a
  devDependency but unused).
- The Dockerfile pins Node 22.14.0 via Volta.

`docs/MODERNIZE.md` calls for: Node.js 24, TypeScript 6+, a full TS
migration, a pnpm workspace managed by Turborepo, Vue 3.7+, swapping
eslint/prettier for oxlint/oxformat, and Vitest + Playwright for testing.

## Decision

We will modernize the stack in six independent, sequential efforts, each on
its own branch/PR with atomic, revertable commits, in this order:

1. **Monorepo restructure** — introduce a pnpm workspace managed by
   Turborepo. Move the current root `src/` into `apps/server`, and move
   `client/` into `apps/client`. The repo root becomes a thin workspace
   manager (root `package.json`, `pnpm-workspace.yaml`, `turbo.json`) with no
   application code of its own.
2. **Node.js 24** — bump `engines.node`, CI runners, and the Dockerfile base
   image/Volta pin to Node 24.
3. **TypeScript migration** — convert all JS in `apps/server` and
   `apps/client` to TypeScript per the conventions in `AGENTS.md` (types over
   interfaces, arrow functions, no `any`, etc.). No `.js` source files should
   remain. `apps/client`'s `.vue` files move to `<script setup lang="ts">`
   with the Composition API now (Vue 2.7 supports both); full `.vue`
   type-checking via `vue-tsc` is deferred to step 4, since `vue-tsc`
   depends on Vue 3's `@vue/compiler-dom` and isn't reliably compatible with
   Vue 2.7 — plain `tsc --noEmit` covers the `.ts` files in the meantime.
4. **Vue 2 → Vue 3.7+** — migrate `apps/client` from Vue 2.7/vue-router 3 to
   Vue 3.7+/vue-router 4, replacing `@vitejs/plugin-vue2` with
   `@vitejs/plugin-vue`, and re-evaluating `vue-chat-scroll` (Vue 2-only) for
   a Vue 3-compatible replacement or a small composable.
5. **Tooling swap** — replace eslint + prettier with oxlint + oxformat across
   the workspace, removing the old configs.
6. **Testing** — introduce Vitest (unit, server + client) and Playwright
   (e2e) with an initial set of characterization tests covering the current
   chat flow (join, send/receive messages, disconnect) before/alongside
   further behavioral changes.

Restructuring first was chosen over item ordering listed in
`docs/MODERNIZE.md` because every later step (TS config, build tooling,
CI paths, test file locations) depends on the final folder layout, and doing
it last would mean touching every migrated file a second time. Tests are
deliberately done last, aligned with the "Migrate first, add tests as part
of the Vitest/Playwright migration step" decision — the two prior legacy
stacks (Vue 2 templates, plain JS) are not worth writing throwaway
characterization tests against.

## Consequences

- Six PRs land sequentially into `master`; each can be reverted independently
  without necessarily reverting the others, though PRs after #1 depend on
  the folder layout from #1, and PRs after #3 depend on TS tooling from #3.
- Until step 6 lands, there is no automated regression coverage, so manual
  verification of the chat flow (join, send, receive, disconnect, push
  notifications) is required after each PR.
- `vue-chat-scroll` has no Vue 3 support; step 4 will need a replacement
  decision (small custom composable vs. a maintained alternative) captured
  as its own follow-up ADR or noted inline in that PR if the choice is
  non-trivial.
- Docker/Fly.io deploy config must be updated in step 2 (Node 24) and
  potentially again in step 1 if build paths change (`apps/server` vs
  `src/`).

## Alternatives considered

- **One branch per item vs. a single long-lived branch**: a single branch
  would reduce PR overhead but makes partial rollback and review harder;
  rejected in favor of one branch/PR per migration item.
- **Tests first (characterization tests before migrating)**: would provide a
  regression safety net but doubles effort by writing tests against code
  that's about to be deleted/rewritten (plain JS server, Vue 2 client);
  rejected in favor of adding tests once the target stack (TS, Vue 3,
  Vitest/Playwright) is in place.
- **server/ + client/ layout**: simpler rename of the existing `client/`
  directory, but less conventional for Turborepo monorepos; rejected in
  favor of `apps/server` + `apps/client`.
</content>
