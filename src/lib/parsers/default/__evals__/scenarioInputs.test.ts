import { buildScenarioFixtures } from './scenarioInputs'

describe('buildScenarioFixtures', () => {
  it('throws on unknown scenario names', async () => {
    await expect(buildScenarioFixtures('not-a-real-scenario')).rejects.toThrow(/Unknown scenario/)
  })

  it('produces a fixture per commit with per-file diffs', async () => {
    // Heavier than the default 5s timeout: this spins up a real
    // temp git repo, runs `git init` + multiple `git commit`s for
    // the feature-pr-ready scenario, then walks the log calling
    // `git show --numstat` + per-file `git show` for each commit.
    // Under load (parallel jest workers) the shell-out + grammar-
    // download cost adds up and periodically blew the old 30s budget.
    // 120s is generous headroom for the heaviest CI runner while still
    // catching a genuine hang.
    const { repo, fixtures } = await buildScenarioFixtures('feature-pr-ready')
    try {
      expect(fixtures.scenario).toBe('feature-pr-ready')
      expect(fixtures.commits.length).toBeGreaterThan(0)
      // Each commit fixture carries a sha + subject + at least one
      // file diff (the scenario writes a fresh file per commit).
      for (const commit of fixtures.commits) {
        expect(commit.shortSha).toMatch(/^[0-9a-f]{8}$/)
        expect(commit.subject.length).toBeGreaterThan(0)
        expect(commit.diffs.length).toBeGreaterThan(0)
        // Every diff has a token count and a non-empty patch body.
        for (const diff of commit.diffs) {
          expect(diff.tokenCount).toBeGreaterThan(0)
          expect(diff.diff.length).toBeGreaterThan(0)
        }
      }
      // The scenario lands on the feat branch; the adapter records it
      // for downstream display.
      expect(fixtures.branch).toBe('feat/widget-v2')
    } finally {
      await repo.cleanup()
    }
  }, 120_000)

  it('extracts the same byte-identical fixture set across runs (determinism)', async () => {
    // Same 30s budget as the sibling test — this one spins up
    // TWO temp git repos serially (to verify determinism), so the
    // cost is roughly double. Same rationale as the other test:
    // shell-out cost under parallel jest load can exceed 5s.
    const a = await buildScenarioFixtures('single-staged-file')
    const b = await buildScenarioFixtures('single-staged-file')
    try {
      expect(a.fixtures.commits.length).toBe(b.fixtures.commits.length)
      for (let i = 0; i < a.fixtures.commits.length; i += 1) {
        // shortSha will differ between runs (different temp dir →
        // different commit tree). Compare the diff bodies instead —
        // those are the eval input and are content-deterministic.
        const aDiffs = a.fixtures.commits[i].diffs.map((d) => d.diff)
        const bDiffs = b.fixtures.commits[i].diffs.map((d) => d.diff)
        expect(aDiffs).toEqual(bDiffs)
      }
    } finally {
      await a.repo.cleanup()
      await b.repo.cleanup()
    }
  }, 120_000)
})
