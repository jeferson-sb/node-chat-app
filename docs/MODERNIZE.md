This is a legacy project I would like to modernize. The codebase is already solid but we need to update dependencies, remove dead code and improve the overall architecture to be make it more suitable for the upcoming features. This will require:

- Migrating to Node.js 24
- Migrating to TypeScript 6.0+
- No JS code should be left in the codebase, migrate everything to TypeScript following the conventions in [AGENTS.md](../AGENTS.md)
- Migrating to a pnpm workspace using turborepo for monorepo management
- Migrating the client side code to Vue 3.7+
- Ditching eslint and prettier in favor of oxlint and oxformat
- Using Playwright for e2e and Vitest for unit testing (Backend and Frontend)

Any migration effort should be done in a separate branch and should be done with atomic commits that can be reverted if needed.
