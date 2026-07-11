/**
 * Fixture-repo helpers for the PTY e2e journeys (#1424).
 *
 * Thin wrapper over `@gfargo/git-scenarios` — the same registry the
 * scenario runner (`npm run scenario`) and the screenshot pipeline use —
 * so e2e journeys, VHS tapes, and manual repro repos all describe repo
 * states in one vocabulary.
 */
import * as fs from 'fs'
import { fromScenario } from '@gfargo/git-scenarios'
import { assertGitRepo } from './ptyHarness'

export interface ScenarioRepo {
  path: string
  cleanup: () => Promise<void> | void
}

/** Materialize a named scenario into a temp repo. Caller must cleanup. */
export async function createScenarioRepo(name: string): Promise<ScenarioRepo> {
  const repo = await fromScenario(name)
  // macOS hands out /var/... temp dirs that are really /private/var/...;
  // resolve so path comparisons inside the TUI (and git) agree.
  const resolved = fs.realpathSync(repo.path)
  assertGitRepo(resolved)
  return { path: resolved, cleanup: repo.cleanup }
}
