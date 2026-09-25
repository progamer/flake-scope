import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

export default defineConfig({
  testDir: './tests',
  // CI runs the demo with --workers=4 --retries=2; mirror that locally so the race reproduces.
  workers: 4,
  retries: 2,
  timeout: 5_000,
  expect: { timeout: 2_000 },
  reporter: [['list'], ['@flakescope/reporter']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node server/server.mjs',
    url: `http://localhost:${PORT}/health`,
    reuseExistingServer: false,
    env: { PORT: String(PORT), DEMO_REGRESSION: process.env.DEMO_REGRESSION ?? '' },
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: /profile-.*\.spec\.ts/,
    },
    {
      // Every test in this project signs in as the same account: the classic shared-state race.
      name: 'chromium-alice',
      use: { ...devices['Desktop Chrome'], storageState: '.auth/alice.json' },
      testMatch: /profile-.*\.spec\.ts/,
      dependencies: ['setup'],
    },
  ],
});
