import { defineConfig } from '@playwright/test';

// Unit tests: no browser or running app needed. HubSpot is mocked.
export default defineConfig({
  testDir: './tests/unit',
  fullyParallel: false,
  workers: 1,
});
