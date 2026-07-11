/**
 * Jest config for the PTY end-to-end journeys (#1424).
 *
 * Separate from jest.config.ts on purpose: these tests boot the REAL
 * built TUI (`dist/index.js`) in a pseudo-terminal against scenario
 * repos, so they need a build first and run in seconds-per-test rather
 * than milliseconds. Run via `npm run test:e2e`.
 */
export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/e2e'],
  testMatch: ['**/*.e2e.test.ts'],
  // Each journey boots a process in a PTY and drives keystrokes —
  // generous ceiling so CI machines under load don't flake.
  testTimeout: 120_000,
  // One suite at a time: concurrent TUI boots contend for CPU enough
  // to stretch first-paint past assertion windows and flake.
  maxWorkers: 1,
}
