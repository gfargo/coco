/**
 * Synthetic-but-realistic diff fixtures for the bench (#845).
 *
 * Two generations of fixtures live here:
 *
 * 1. **Sized fixtures** (`tinyFixture`, `mediumFixture`,
 *    `largeFixture`) — same names as the v0 LCG fixtures but now
 *    populated with realistic per-language content (TypeScript,
 *    Python, Markdown, JSON, YAML). These keep the original
 *    file-count + token-count shapes so the baseline diff stays
 *    semantically comparable across generations.
 *
 * 2. **Scenario fixtures** (`featureAddFixture`, `refactorFixture`,
 *    `initialCommitFixture`, `docsUpdateFixture`, `depBumpFixture`)
 *    — model real-world commit shapes the user is likely to run
 *    `coco commit` against. Each scenario mixes file types, diff
 *    shapes (additions, modifications, renames, binary), and sizes
 *    that reflect the named workflow.
 *
 * Determinism note: every generator and shape wrapper is seeded so
 * the same fixture name always produces identical content. Re-runs
 * of `npm run bench` therefore compare apples-to-apples without
 * any environmental drift.
 */

import { DiffNode, FileDiff } from '../../../types'
import {
  asAdditionDiff,
  asBinaryDiff,
  asDeletionDiff,
  asModificationDiff,
  asRenameDiff,
  DiffShape,
} from './diffs'
import { generateContentForFile } from './generators'

type FileSpec = {
  path: string
  tokens: number
  /** Defaults to 'addition' to mirror initial-commit shape. */
  shape?: DiffShape
  /** For renames; the prior path. */
  oldPath?: string
}

function buildFileDiff(spec: FileSpec, seed: number): FileDiff {
  const shape = spec.shape || 'addition'
  let diff: string
  switch (shape) {
    case 'addition':
      diff = asAdditionDiff(spec.path, generateContentForFile(spec.path, spec.tokens, seed))
      break
    case 'deletion':
      diff = asDeletionDiff(spec.path, generateContentForFile(spec.path, spec.tokens, seed))
      break
    case 'modification':
      diff = asModificationDiff(
        spec.path,
        generateContentForFile(spec.path, spec.tokens, seed),
        generateContentForFile(spec.path, Math.floor(spec.tokens * 0.6), seed + 1)
      )
      break
    case 'rename':
      diff = asRenameDiff(spec.oldPath || `old/${spec.path}`, spec.path)
      break
    case 'binary':
      diff = asBinaryDiff(spec.path)
      break
  }
  return {
    file: spec.path,
    diff,
    summary: '',
    tokenCount: spec.tokens,
  }
}

function buildDiffNode(name: string, files: FileSpec[]): DiffNode {
  const root: DiffNode = { path: '/', diffs: [], children: [] }
  const dirIndex = new Map<string, DiffNode>([['/', root]])

  files.forEach((file, index) => {
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

    const seed = hashString(`${name}:${file.path}:${index}`)
    node.diffs.push(buildFileDiff({ ...file, path: file.path }, seed))
    void fileName
  })

  return root
}

/**
 * Cheap deterministic seed derivation from a string. We don't care
 * about distribution quality — just stability across runs and
 * reasonable spread between adjacent file paths.
 */
function hashString(input: string): number {
  let hash = 5381
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) >>> 0
  }
  return hash || 1
}

// ---------------------------------------------------------------------------
// Sized fixtures (preserve v0 names + counts; fresh content)
// ---------------------------------------------------------------------------

const TINY_FILES: FileSpec[] = [
  { path: 'src/index.ts', tokens: 200 },
  { path: 'src/util.ts', tokens: 150 },
  { path: 'README.md', tokens: 300 },
  { path: 'package.json', tokens: 80 },
  { path: 'tsconfig.json', tokens: 60 },
]

const MEDIUM_FILES: FileSpec[] = [
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
]

const LARGE_FILES: FileSpec[] = [
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
]

// ---------------------------------------------------------------------------
// Scenario fixtures (real-world commit shapes)
// ---------------------------------------------------------------------------

/**
 * Feature add: new component + supporting modules + tests + a doc
 * touch-up + a README mention. Mostly additions, a couple of
 * modifications. Mirrors "I just shipped a new screen / endpoint /
 * CLI command" workflow.
 */
const FEATURE_ADD_FILES: FileSpec[] = [
  { path: 'src/features/billing/index.ts', tokens: 2200, shape: 'addition' },
  { path: 'src/features/billing/handler.ts', tokens: 3800, shape: 'addition' },
  { path: 'src/features/billing/schema.ts', tokens: 1100, shape: 'addition' },
  { path: 'src/features/billing/validators.ts', tokens: 1600, shape: 'addition' },
  { path: 'src/features/billing/types.ts', tokens: 700, shape: 'addition' },
  { path: 'src/features/billing/utils.ts', tokens: 900, shape: 'addition' },
  { path: 'tests/features/billing/handler.test.ts', tokens: 2100, shape: 'addition' },
  { path: 'tests/features/billing/validators.test.ts', tokens: 1400, shape: 'addition' },
  { path: 'tests/features/billing/fixtures.json', tokens: 800, shape: 'addition' },
  { path: 'src/router.ts', tokens: 600, shape: 'modification' },
  { path: 'src/index.ts', tokens: 400, shape: 'modification' },
  { path: 'README.md', tokens: 500, shape: 'modification' },
  { path: 'docs/billing.md', tokens: 1200, shape: 'addition' },
  { path: 'CHANGELOG.md', tokens: 300, shape: 'modification' },
]

/**
 * Refactor: lots of touched files, mostly modifications. Common
 * pattern: rename a module, propagate the new import path through
 * dozens of call sites. Real-world this is where the pipeline does
 * the most LLM work because each file has both `+` and `-` lines.
 */
const REFACTOR_FILES: FileSpec[] = [
  { path: 'src/parsers/legacy/index.ts', tokens: 0, shape: 'rename', oldPath: 'src/parsers/index.ts' },
  ...Array.from({ length: 18 }, (_, i): FileSpec => ({
    path: `src/parsers/legacy/handler-${i}.ts`,
    tokens: 600 + (i * 90) % 1500,
    shape: 'modification',
  })),
  ...Array.from({ length: 8 }, (_, i): FileSpec => ({
    path: `tests/parsers/handler-${i}.test.ts`,
    tokens: 500 + (i * 110) % 900,
    shape: 'modification',
  })),
  { path: 'src/router.ts', tokens: 800, shape: 'modification' },
  { path: 'src/registry.ts', tokens: 1100, shape: 'modification' },
  { path: 'docs/ARCHITECTURE.md', tokens: 600, shape: 'modification' },
]

/**
 * Initial commit: the user's #845 repro shape — many files, mostly
 * pure additions, mixed languages. Reuses LARGE_FILES.
 */
const INITIAL_COMMIT_FILES: FileSpec[] = LARGE_FILES.map((file): FileSpec => ({
  ...file,
  shape: 'addition',
}))

/**
 * Docs update: a documentation pass — multiple markdown files
 * touched, no code. Should be relatively cheap if the pipeline can
 * fast-path markdown.
 */
const DOCS_UPDATE_FILES: FileSpec[] = [
  { path: 'README.md', tokens: 1800, shape: 'modification' },
  { path: 'docs/getting-started.md', tokens: 2400, shape: 'modification' },
  { path: 'docs/configuration.md', tokens: 2100, shape: 'modification' },
  { path: 'docs/troubleshooting.md', tokens: 1500, shape: 'modification' },
  { path: 'docs/api/overview.md', tokens: 1900, shape: 'modification' },
  { path: 'docs/api/reference.md', tokens: 3200, shape: 'modification' },
  { path: 'CHANGELOG.md', tokens: 800, shape: 'modification' },
  { path: 'CONTRIBUTING.md', tokens: 1100, shape: 'modification' },
  { path: '.github/ISSUE_TEMPLATE/bug.md', tokens: 250, shape: 'addition' },
]

/**
 * Dep bump: the dependabot-style commit. Tiny content change in
 * package.json, large lockfile delta. Pipeline should mostly
 * skip-trivial these.
 */
const DEP_BUMP_FILES: FileSpec[] = [
  { path: 'package.json', tokens: 250, shape: 'modification' },
  { path: 'yarn.lock', tokens: 8000, shape: 'modification' },
  { path: 'CHANGELOG.md', tokens: 200, shape: 'modification' },
]

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export type DiffFixture = {
  name: string
  fileCount: number
  approxTokens: number
  rootNode: DiffNode
}

function asFixture(name: string, files: FileSpec[]): DiffFixture {
  return {
    name,
    fileCount: files.length,
    approxTokens: files.reduce((sum, file) => sum + file.tokens, 0),
    rootNode: buildDiffNode(name, files),
  }
}

export const tinyFixture: DiffFixture = asFixture('tiny', TINY_FILES)
export const mediumFixture: DiffFixture = asFixture('medium', MEDIUM_FILES)
export const largeFixture: DiffFixture = asFixture('large', LARGE_FILES)

export const featureAddFixture: DiffFixture = asFixture('feature-add', FEATURE_ADD_FILES)
export const refactorFixture: DiffFixture = asFixture('refactor', REFACTOR_FILES)
export const initialCommitFixture: DiffFixture = asFixture('initial-commit', INITIAL_COMMIT_FILES)
export const docsUpdateFixture: DiffFixture = asFixture('docs-update', DOCS_UPDATE_FILES)
export const depBumpFixture: DiffFixture = asFixture('dep-bump', DEP_BUMP_FILES)

export const allFixtures: DiffFixture[] = [
  tinyFixture,
  mediumFixture,
  largeFixture,
  featureAddFixture,
  refactorFixture,
  initialCommitFixture,
  docsUpdateFixture,
  depBumpFixture,
]
