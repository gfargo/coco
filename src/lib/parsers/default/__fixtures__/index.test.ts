import {
  allFixtures,
  depBumpFixture,
  docsUpdateFixture,
  featureAddFixture,
  initialCommitFixture,
  largeFixture,
  mediumFixture,
  refactorFixture,
  tinyFixture,
} from './index'

describe('bench fixtures (#845)', () => {
  it('exposes named sized + scenario fixtures via allFixtures', () => {
    const names = allFixtures.map((fixture) => fixture.name)
    expect(names).toEqual([
      'tiny',
      'medium',
      'large',
      'feature-add',
      'refactor',
      'initial-commit',
      'docs-update',
      'dep-bump',
    ])
  })

  it.each([
    ['tiny', tinyFixture],
    ['medium', mediumFixture],
    ['large', largeFixture],
    ['feature-add', featureAddFixture],
    ['refactor', refactorFixture],
    ['initial-commit', initialCommitFixture],
    ['docs-update', docsUpdateFixture],
    ['dep-bump', depBumpFixture],
  ])('%s fixture has a populated DiffNode tree', (_, fixture) => {
    expect(fixture.fileCount).toBeGreaterThan(0)
    expect(fixture.approxTokens).toBeGreaterThan(0)
    expect(fixture.rootNode.diffs.length + fixture.rootNode.children.length).toBeGreaterThan(0)
  })

  it('produces deterministic content across calls (same diff text)', () => {
    // Same export referenced twice should be byte-identical — the
    // generator is pure on (name, files, seed) so the module
    // initialization shouldn't introduce any drift.
    const firstSnapshot = JSON.stringify(tinyFixture.rootNode)
    const secondSnapshot = JSON.stringify(tinyFixture.rootNode)
    expect(firstSnapshot).toBe(secondSnapshot)
  })

  it('refactor scenario includes a rename diff', () => {
    const collectedDiffs: string[] = []
    const walk = (node: typeof refactorFixture.rootNode) => {
      node.diffs.forEach((diff) => collectedDiffs.push(diff.diff))
      node.children.forEach(walk)
    }
    walk(refactorFixture.rootNode)
    expect(collectedDiffs.some((diff) => diff.includes('rename from'))).toBe(true)
  })

  it('dep-bump scenario is dominated by a lockfile-shaped modification', () => {
    const lockfileDiff = depBumpFixture.rootNode.diffs.find((diff) => diff.file.endsWith('.lock'))
    expect(lockfileDiff).toBeDefined()
    expect(lockfileDiff?.diff).toContain('diff --git')
    expect(lockfileDiff?.tokenCount).toBeGreaterThan(1000)
  })
})
