export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  transformIgnorePatterns: ['/node_modules/', '/dist/'],
  // `@langchain/mistralai` re-exports the official `@mistralai/mistralai`
  // SDK, which ships as pure ESM (no CommonJS build). ts-jest runs tests
  // through CommonJS `require`, which cannot load that ESM entry, so every
  // suite that pulls in the provider registry would fail to load the module
  // graph. Map the wrapper to a lightweight stub for tests; runtime/build
  // are unaffected (they consume the real package).
  moduleNameMapper: {
    '^@langchain/mistralai$': '<rootDir>/src/test/mocks/langchainMistral.ts',
  },
  // Constrain test discovery to the directories that actually contain
  // coco's tests. Without this, jest's default recursion from the
  // repo root descends into:
  //   - `.claude/worktrees/*` — Claude Code's per-agent worktrees,
  //     each containing 150+ duplicate test files
  //   - `.www/` — the marketing-site sub-project, which has its own
  //     test runner (and its own nested `node_modules` with hundreds
  //     of vendored test files)
  // `<rootDir>` resolves per-config-file location, so each worktree
  // independently scans its own `src/` + `bin/` and the main checkout
  // does the same. No cross-contamination.
  roots: ['<rootDir>/src', '<rootDir>/bin'],
  // Coverage configuration — opt-in via `--coverage` so the default
  // `npm run test:jest` stays fast. CI runs `--coverage` to upload
  // lcov output to Codecov.
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.test.ts',
    // Type-only modules and yargs glue files are scaffolding rather
    // than logic — excluded so they don't dilute the signal of
    // actually-tested code.
    '!src/**/types.ts',
    '!src/**/index.ts',
    // Generated files (build info, schema) re-emit on every build.
    '!src/lib/buildInfo.ts',
    '!src/lib/schema.ts',
  ],
  coverageReporters: ['text-summary', 'lcov', 'json-summary'],
  coverageDirectory: 'coverage',
  // Thresholds set just below current measured coverage so they
  // act as a guardrail against regressions while leaving headroom
  // for normal noise. Current floor (May 2026): statements 63.78%,
  // branches 58.18%, functions 64.69%, lines 64.39%. Ratchet up
  // when surface tests + inkRuntime boot tests land. CI fails if
  // coverage drops below these numbers, which is the bare minimum
  // protection against accidental regressions.
  coverageThreshold: {
    global: {
      statements: 60,
      branches: 55,
      functions: 60,
      lines: 60,
    },
  },
}
