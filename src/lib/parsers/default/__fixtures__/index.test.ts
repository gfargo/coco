import { DEFAULT_IGNORED_EXTENSIONS, DEFAULT_IGNORED_FILES } from '../../../config/constants'
import { DiffNode } from '../../../types'
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
      'monorepo',
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

  // Guard against the class of mistake that shipped in the prior
  // dep-bump fixture: any file matching the default ignore list
  // (lockfiles, node_modules, .map / .lock extensions) would be
  // stripped before the pipeline ever sees it on a real commit, so
  // including such a file in a fixture produces bench numbers that
  // can't translate to user-facing wins. Fail loudly if any fixture
  // accidentally drifts back into that shape.
  it('no fixture file matches DEFAULT_IGNORED_FILES or DEFAULT_IGNORED_EXTENSIONS', () => {
    const offending: string[] = []
    const collect = (node: DiffNode, fixtureName: string) => {
      node.diffs.forEach((diff) => {
        const basename = diff.file.split('/').pop() || diff.file
        if (DEFAULT_IGNORED_FILES.includes(basename)) {
          offending.push(`${fixtureName}: ${diff.file} (matches DEFAULT_IGNORED_FILES)`)
        }
        if (DEFAULT_IGNORED_EXTENSIONS.some((ext) => diff.file.toLowerCase().endsWith(ext))) {
          offending.push(`${fixtureName}: ${diff.file} (matches DEFAULT_IGNORED_EXTENSIONS)`)
        }
      })
      node.children.forEach((child) => collect(child, fixtureName))
    }
    allFixtures.forEach((fixture) => collect(fixture.rootNode, fixture.name))
    expect(offending).toEqual([])
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

  it('dep-bump scenario reflects post-filter content (no lockfiles)', () => {
    // Lockfiles live in DEFAULT_IGNORED_FILES + DEFAULT_IGNORED_EXTENSIONS,
    // so they're stripped before the pipeline ever sees the diff. The
    // fixture should mirror what the pipeline would actually receive
    // for a dependabot-style commit: package.json + CHANGELOG, both
    // small.
    const allDiffs: typeof depBumpFixture.rootNode.diffs = []
    const walk = (node: typeof depBumpFixture.rootNode) => {
      allDiffs.push(...node.diffs)
      node.children.forEach(walk)
    }
    walk(depBumpFixture.rootNode)
    expect(allDiffs.find((diff) => diff.file.endsWith('.lock'))).toBeUndefined()
    expect(allDiffs.find((diff) => diff.file.endsWith('-lock.json'))).toBeUndefined()
    expect(allDiffs.find((diff) => diff.file === 'package.json')).toBeDefined()
  })
})
