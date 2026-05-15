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
  // Serial execution. The tree-sitter integration tests dynamically
  // import `web-tree-sitter` (an ESM-only module that ships an
  // emscripten engine) under `NODE_OPTIONS=--experimental-vm-modules`.
  // With Jest's default worker-pool parallelism the import races
  // across workers: one worker tears down its environment while
  // another's dynamic-import is still in flight, the import rejects
  // with "trying to `import` a file after the Jest environment has
  // been torn down," the runtime's silent catch resolves it to
  // `undefined`, and the wasm-backed parser tests assert against a
  // surprise empty string.
  //
  // Verified locally: `--runInBand` produces 1933/1933 pass; default
  // parallelism produces 4 failures in `tsTreeSitterParser.test.ts`
  // every time. Going to one worker is the minimum-surgery fix until
  // we can untangle the ESM-dynamic-import / worker-teardown
  // interaction properly (likely needs a per-test-file fresh runtime
  // module via `jest.isolateModules`, or moving the engine init to a
  // setup file outside the worker boundary).
  maxWorkers: 1,
}
