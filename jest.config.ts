export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  transformIgnorePatterns: ['/node_modules/', '/dist/'],
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
  // Silence the post-teardown ESM-dynamic-import rejection from
  // `web-tree-sitter` that surfaces as an unhandled rejection at the
  // process level after all tests have passed. See `bin/jestSetup.cjs`
  // for the narrow matcher and gfargo/coco#979 for the proper fix
  // (wrap the runtime in `jest.isolateModules` or move engine init
  // into a global setup hook outside worker boundaries).
  setupFiles: ['<rootDir>/bin/jestSetup.cjs'],
}

// Note: serial test execution (--runInBand) is enforced via the
// `test:jest` npm script, not here. Jest reads `maxWorkers: 1` from
// this config but in practice still spins up a worker thread alongside
// the main thread, leaving the worker-teardown race that breaks the
// `web-tree-sitter` ESM dynamic-import in `tsTreeSitterParser.test.ts`.
// `--runInBand` actually keeps everything in-process and side-steps
// the race entirely. Verified locally: `--runInBand` produces
// 1933/1933 pass; default parallelism produces 4 failures every time.
// `--forceExit` plus the setupFiles hook above closes the exit-code
// gap (the late-rejection swallow lets Jest finish cleanly).
