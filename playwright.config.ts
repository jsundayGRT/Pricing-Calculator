import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testIgnore: 'unit/**',
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
