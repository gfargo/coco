/**
 * Scenario type definitions for `packages/git-scenarios/src/scenarios/`.
 *
 * EXTRACTION DISCIPLINE: this layer is intentionally git-tool-agnostic
 * and a candidate for extraction to a standalone `git-scenarios` package
 * once the abstractions stabilize. See `packages/git-scenarios/README.md`
 * for the boundary rules and extraction criteria.
 *
 * In short: this file MUST NOT import anything from `src/commands/`,
 * `src/git/`, or `src/workstation/`. The dependency graph stops at
 * `simple-git` / Node stdlib / `__fixtures__/generators.ts` (itself
 * git-agnostic).
 */

import type { TempGitRepo } from '../tempGitRepo'

/**
 * Categorization for filtering / listing. Used by the CLI's `list`
 * subcommand to group scenarios when there are many of them.
 *
 *   - `branch`     — multi-commit branches, PR-ready states, etc.
 *   - `worktree`   — dirty worktrees of various shapes
 *   - `operation`  — in-progress git operations (bisect, merge, rebase)
 *   - `history`    — history-shape scenarios (large logs, many tags)
 *   - `stash`      — stashed changes
 *   - `submodule`  — repos with one or more registered submodules
 */
export type ScenarioKind = 'branch' | 'worktree' | 'operation' | 'history' | 'stash' | 'submodule'

/**
 * A named, deterministic git-state factory. Given a fresh `TempGitRepo`
 * (already `git init`'d with a `main` branch and user config), `setup`
 * brings the repo into the named state — commits, branches, staging,
 * bisect, conflicts, etc.
 *
 * Setup is the ONLY side effect. The factory doesn't manage cleanup —
 * that's the caller's job (test teardown, or the CLI's manual cleanup
 * hint). The factory doesn't manage seeds either — scenarios that want
 * deterministic file content pass an explicit `seed` into the content
 * generators they use.
 */
export type Scenario = {
  /** Stable identifier — kebab-case. Used as the CLI argument. */
  name: string
  /** One-line summary shown in `npm run scenario list`. */
  summary: string
  /** Multi-line description shown in `npm run scenario describe <name>`. */
  description: string
  /** Filtering category. */
  kind: ScenarioKind
  /** The actual state factory. Mutates the given repo. */
  setup: (repo: TempGitRepo) => Promise<void>
  /**
   * Optional: a list of human-readable expectations the test layer
   * verifies. Each line is something like "main has 5 commits" or
   * "bisect is active." These also document the scenario's contract
   * for the CLI's `describe` output.
   */
  contracts?: string[]
}
