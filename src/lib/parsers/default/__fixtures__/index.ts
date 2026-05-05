/**
 * Synthetic diff fixtures for benchmarking the diff-condensing
 * pipeline (#845). Each fixture is a fully-populated `DiffNode` tree
 * so callers can invoke `summarizeDiffs` directly without standing
 * up a git repo.
 *
 * Numbers are picked to mirror the user-reported 4-minute repro
 * shape:
 *   - tiny: early-exit path (already under budget)
 *   - medium: typical real commit (~25 files, ~40k tokens)
 *   - large: initial-commit shape (~50 files, ~100k tokens)
 *
 * Determinism matters more than realism: the synthetic content is
 * generated from a stable seed so before/after benchmark runs
 * compare the same input.
 */

import { DiffNode, FileDiff } from '../../../types'

/**
 * Tiny pseudo-LCG — keeps the synthetic content stable across runs
 * without pulling in a seedable PRNG dep. The output is character
 * pattern, not statistically random; that's fine for a bench fixture.
 */
function seededTextBlob(lengthChars: number, seed: number): string {
  const corpus = 'abcdefghijklmnopqrstuvwxyz0123456789 \n'
  let state = seed >>> 0
  let out = ''
  for (let i = 0; i < lengthChars; i++) {
    state = (state * 1664525 + 1013904223) >>> 0
    out += corpus[state % corpus.length]
  }
  return out
}

/**
 * Build a synthetic file diff at approximately the requested token
 * count. Token estimate uses chars/4 which is rough but consistent
 * with how tiktoken behaves for prose-like content; the runner
 * re-tokenizes with the real counter at fixture-load time so the
 * recorded `tokenCount` is exact.
 */
function buildFileDiff(file: string, approxTokens: number, seed: number): FileDiff {
  const chars = approxTokens * 4
  const header = `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1,1 +1,${Math.max(1, Math.floor(approxTokens / 4))} @@\n`
  const body = seededTextBlob(chars, seed)
    .split('\n')
    .map((line) => `+${line}`)
    .join('\n')
  return {
    file,
    diff: header + body,
    summary: '',
    tokenCount: approxTokens,
  }
}

type FixtureSpec = {
  name: string
  files: Array<{ path: string; tokens: number }>
}

const TINY_SPEC: FixtureSpec = {
  name: 'tiny',
  files: [
    { path: 'src/index.ts', tokens: 200 },
    { path: 'src/util.ts', tokens: 150 },
    { path: 'README.md', tokens: 300 },
    { path: 'package.json', tokens: 80 },
    { path: 'tsconfig.json', tokens: 60 },
  ],
}

const MEDIUM_SPEC: FixtureSpec = {
  name: 'medium',
  files: [
    { path: 'src/api.ts', tokens: 3500 },
    { path: 'src/auth.ts', tokens: 2400 },
    { path: 'src/cli.ts', tokens: 4800 },
    { path: 'src/parser.ts', tokens: 2900 },
    { path: 'src/utils/http.ts', tokens: 1200 },
    { path: 'src/utils/format.ts', tokens: 800 },
    { path: 'src/utils/logger.ts', tokens: 600 },
    { path: 'tests/api.test.ts', tokens: 1800 },
    { path: 'tests/auth.test.ts', tokens: 1400 },
    { path: 'tests/parser.test.ts', tokens: 1600 },
    { path: 'tests/utils/http.test.ts', tokens: 700 },
    { path: 'tests/fixtures/sample.json', tokens: 500 },
    { path: 'docs/ARCHITECTURE.md', tokens: 2300 },
    { path: 'docs/API.md', tokens: 1900 },
    { path: 'docs/CONTRIBUTING.md', tokens: 1100 },
    { path: 'README.md', tokens: 3000 },
    { path: 'CHANGELOG.md', tokens: 1800 },
    { path: '.github/workflows/ci.yml', tokens: 600 },
    { path: '.github/workflows/release.yml', tokens: 900 },
    { path: '.github/ISSUE_TEMPLATE/bug.md', tokens: 400 },
    { path: 'package.json', tokens: 700 },
    { path: 'tsconfig.json', tokens: 200 },
    { path: '.gitignore', tokens: 150 },
    { path: 'LICENSE', tokens: 300 },
    { path: 'pyproject.toml', tokens: 600 },
  ],
}

const LARGE_SPEC: FixtureSpec = {
  name: 'large',
  files: [
    // Mirror of the user's 43-file initial commit shape, scaled up
    // a bit (50 files / ~100k tokens) so we have headroom for both
    // pre-process and consolidation phases to fire heavily.
    { path: 'humble_bundle_keys/api.py', tokens: 4400 },
    { path: 'humble_bundle_keys/auth.py', tokens: 2100 },
    { path: 'humble_bundle_keys/cli.py', tokens: 7600 },
    { path: 'humble_bundle_keys/diagnose.py', tokens: 6100 },
    { path: 'humble_bundle_keys/scraper.py', tokens: 5200 },
    { path: 'humble_bundle_keys/choice.py', tokens: 4500 },
    { path: 'humble_bundle_keys/browser_choice.py', tokens: 5500 },
    { path: 'humble_bundle_keys/exporter.py', tokens: 1300 },
    { path: 'humble_bundle_keys/models.py', tokens: 700 },
    { path: 'humble_bundle_keys/_browser_fetch.py', tokens: 1000 },
    { path: 'humble_bundle_keys/_orders_cache.py', tokens: 1200 },
    { path: 'humble_bundle_keys/__init__.py', tokens: 110 },
    { path: 'humble_bundle_keys/__main__.py', tokens: 110 },
    { path: 'tests/RUNBOOK.md', tokens: 1900 },
    { path: 'tests/test_api_parser.py', tokens: 1400 },
    { path: 'tests/test_browser_choice.py', tokens: 1200 },
    { path: 'tests/test_browser_fetch.py', tokens: 1100 },
    { path: 'tests/test_choice.py', tokens: 3000 },
    { path: 'tests/test_diagnose_sanitiser.py', tokens: 2300 },
    { path: 'tests/test_exporter.py', tokens: 1700 },
    { path: 'tests/test_parsers.py', tokens: 600 },
    { path: 'tests/__init__.py', tokens: 40 },
    { path: 'tests/fixtures/choice_claim/README.md', tokens: 400 },
    { path: 'tests/fixtures/choice_claim/analytics_get_game.json', tokens: 500 },
    { path: 'tests/fixtures/choice_claim/analytics_tile_click.json', tokens: 500 },
    { path: 'tests/fixtures/choice_claim/choosecontent.json', tokens: 600 },
    { path: 'tests/fixtures/choice_claim/redeemkey.json', tokens: 600 },
    { path: 'docs/ARCHITECTURE.md', tokens: 2300 },
    { path: 'docs/CHOICE_CLAIM_SPEC.md', tokens: 3900 },
    { path: 'docs/WHATS_CLAIMABLE.md', tokens: 1300 },
    { path: 'README.md', tokens: 3900 },
    { path: 'CHANGELOG.md', tokens: 3800 },
    { path: 'CONTRIBUTING.md', tokens: 1200 },
    { path: 'SECURITY.md', tokens: 1000 },
    { path: 'LICENSE', tokens: 300 },
    { path: 'pyproject.toml', tokens: 600 },
    { path: '.gitignore', tokens: 700 },
    { path: '.github/ISSUE_TEMPLATE/bug_report.md', tokens: 400 },
    { path: '.github/ISSUE_TEMPLATE/feature_request.md', tokens: 250 },
    { path: '.github/ISSUE_TEMPLATE/selector_broken.md', tokens: 500 },
    { path: '.github/ISSUE_TEMPLATE/config.yml', tokens: 200 },
    { path: '.github/workflows/ci.yml', tokens: 600 },
    { path: '.github/workflows/release.yml', tokens: 900 },
    { path: 'src/feature/a.ts', tokens: 1400 },
    { path: 'src/feature/b.ts', tokens: 1100 },
    { path: 'src/feature/c.ts', tokens: 900 },
    { path: 'src/feature/d.ts', tokens: 800 },
    { path: 'src/feature/e.ts', tokens: 700 },
    { path: 'src/feature/utils.ts', tokens: 600 },
    { path: 'src/feature/types.ts', tokens: 400 },
  ],
}

/**
 * Convert a flat fixture spec into a nested DiffNode tree, grouping
 * by directory path. Mirrors `createDiffTree`'s behavior on real
 * file lists.
 */
function buildDiffNode(spec: FixtureSpec): DiffNode {
  const root: DiffNode = { path: '/', diffs: [], children: [] }
  const dirIndex = new Map<string, DiffNode>([['/', root]])

  spec.files.forEach((file, index) => {
    const segments = file.path.split('/')
    const fileName = segments.pop() as string
    const dirSegments = segments

    let node = root
    let pathSoFar = ''
    for (const segment of dirSegments) {
      pathSoFar = pathSoFar ? `${pathSoFar}/${segment}` : segment
      const cached = dirIndex.get(pathSoFar)
      if (cached) {
        node = cached
        continue
      }
      const child: DiffNode = { path: segment, diffs: [], children: [] }
      node.children.push(child)
      dirIndex.set(pathSoFar, child)
      node = child
    }

    node.diffs.push(buildFileDiff(`${dirSegments.join('/')}${dirSegments.length ? '/' : ''}${fileName}`, file.tokens, index + 1))
  })

  return root
}

export type DiffFixture = {
  name: string
  fileCount: number
  approxTokens: number
  rootNode: DiffNode
}

function asFixture(spec: FixtureSpec): DiffFixture {
  return {
    name: spec.name,
    fileCount: spec.files.length,
    approxTokens: spec.files.reduce((sum, file) => sum + file.tokens, 0),
    rootNode: buildDiffNode(spec),
  }
}

export const tinyFixture: DiffFixture = asFixture(TINY_SPEC)
export const mediumFixture: DiffFixture = asFixture(MEDIUM_SPEC)
export const largeFixture: DiffFixture = asFixture(LARGE_SPEC)

export const allFixtures: DiffFixture[] = [tinyFixture, mediumFixture, largeFixture]
