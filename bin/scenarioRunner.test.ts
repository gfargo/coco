/**
 * Tests for the `npm run scenario` wrapper around `@gfargo/git-scenarios`.
 *
 * The wrapper exists to intercept coco's documented `--run-ui` shortcut
 * (which the base CLI doesn't know about) and rewrite it to the
 * equivalent `--run "tsx <coco>/src/index.ts ui"`. Without these tests
 * a stale wrapper would silently drop `--run-ui` again — the exact bug
 * this file is here to prevent.
 */
import path from 'node:path'
import { RUN_UI_FLAG, rewriteRunUi } from './scenarioRunner/runUiFlag'

// Stable fake repo root so test assertions don't depend on the actual
// install path of the test runner.
const FAKE_ROOT = '/tmp/fake-coco-repo'
const EXPECTED_UI_CMD = `tsx ${path.join(FAKE_ROOT, 'src/index.ts')} ui`

describe('scenarioRunner', () => {
  describe('RUN_UI_FLAG', () => {
    it('exports the literal flag string consumers can rely on', () => {
      // Pinning the literal so a typo refactor surfaces immediately.
      expect(RUN_UI_FLAG).toBe('--run-ui')
    })
  })

  describe('rewriteRunUi', () => {
    it('replaces a bare --run-ui with --run + the tsx ui spawn command', () => {
      expect(rewriteRunUi(['create', 'empty-repo', '--run-ui'], FAKE_ROOT))
        .toEqual(['create', 'empty-repo', '--run', EXPECTED_UI_CMD])
    })

    it('preserves the position of --run-ui in the argv', () => {
      // Some users might pass --run-ui before the scenario name or
      // interleaved with other flags. The rewrite shouldn't reorder.
      expect(rewriteRunUi(['--run-ui', 'create', 'empty-repo', '--ephemeral'], FAKE_ROOT))
        .toEqual(['--run', EXPECTED_UI_CMD, 'create', 'empty-repo', '--ephemeral'])
    })

    it('is a no-op when --run-ui is absent', () => {
      const argv = ['create', 'feature-pr-ready', '--run', 'lazygit']
      expect(rewriteRunUi(argv, FAKE_ROOT)).toEqual(argv)
    })

    it('rewrites every occurrence (rare, but well-defined)', () => {
      // Defensive: if somehow the user passes --run-ui twice (alias
      // misconfig, doubled-up via shell quoting), every occurrence
      // gets the same rewrite. Easier than failing or deduping
      // unexpectedly.
      expect(rewriteRunUi(['--run-ui', 'create', 'empty-repo', '--run-ui'], FAKE_ROOT))
        .toEqual([
          '--run', EXPECTED_UI_CMD,
          'create', 'empty-repo',
          '--run', EXPECTED_UI_CMD,
        ])
    })

    it('returns an empty array for empty argv', () => {
      expect(rewriteRunUi([], FAKE_ROOT)).toEqual([])
    })

    it('does not match flags that merely contain "run-ui" as a substring', () => {
      // Defensive: only the exact `--run-ui` token rewrites. Some
      // hypothetical future flag like `--run-ui-mode` should pass
      // through unchanged (and trigger a git-scenarios error if it's
      // not a real flag, surfacing the typo to the user).
      const argv = ['create', 'empty-repo', '--run-ui-mode', 'foo']
      expect(rewriteRunUi(argv, FAKE_ROOT)).toEqual(argv)
    })
  })
})
