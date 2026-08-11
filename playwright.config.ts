import { defineConfig, devices } from '@playwright/test';
import { BETTER_AUTH_SECRET, DATABASE_URL } from './e2e/env.ts';

const CLIENT_PORT = 5300;
const SERVER_PORT = 5301;
const baseURL = `http://localhost:${CLIENT_PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  globalSetup: './e2e/globalSetup.ts',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      name: 'server',
      command: 'pnpm --filter @chatme/server dev',
      url: `http://localhost:${SERVER_PORT}/socket.io/`,
      reuseExistingServer: !process.env.CI,
      env: {
        PORT: String(SERVER_PORT),
        NODE_ENV: 'test',
        DATABASE_URL,
        BETTER_AUTH_SECRET,
        BETTER_AUTH_URL: `http://localhost:${SERVER_PORT}`,
        CLIENT_APP_URL: baseURL,
      },
      stdout: 'pipe',
    },
    {
      name: 'client',
      command: `pnpm --filter @chatme/client exec vite --port ${CLIENT_PORT}`,
      url: baseURL,
      reuseExistingServer: !process.env.CI,
      env: { VITE_SOCKET_URL: `http://localhost:${SERVER_PORT}` },
      stdout: 'pipe',
    },
  ],
});
