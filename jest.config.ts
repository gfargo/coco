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
  roots: ['<rootDir>/src', '<rootDir>/bin', '<rootDir>/packages/git-scenarios'],
  // Path mapping for the in-monorepo `@gfargo/git-scenarios` package.
  // Mirrors the `paths` block in `tsconfig.json` — both ts-jest's type
  // checker and the runtime module resolver need to know the alias.
  // Once the package ships standalone, these entries get replaced by
  // the published `node_modules/@gfargo/git-scenarios` resolution.
  moduleNameMapper: {
    '^@gfargo/git-scenarios$': '<rootDir>/packages/git-scenarios/src/index.ts',
    '^@gfargo/git-scenarios/(.*)$': '<rootDir>/packages/git-scenarios/src/$1',
  },
}
