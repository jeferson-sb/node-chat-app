import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Multiple integration test files each boot a real HTTP server + an
    // in-process Postgres and do real (CPU-bound) password hashing via
    // Better Auth. Running those files in parallel worker threads causes
    // enough CPU contention to blow past even a generous per-test timeout
    // (observed: chatFlow.integration.test.ts timing out at 15s under
    // full-suite parallel runs, passing consistently at ~2s in isolation
    // or with this off).
    fileParallelism: false,
  },
});
