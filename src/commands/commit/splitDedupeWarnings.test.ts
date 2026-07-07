/**
 * Coverage for #1462: `rescueDuplicateFiles`/`rescueDuplicateHunks` can
 * silently drop a file/hunk placement the model had also put in an
 * earlier group, producing a plan that passes validation cleanly with
 * NO indication a placement was auto-resolved (unlike the `fallback`
 * path, which is always surfaced). These tests pin `formatDedupeWarnings`'
 * rendering and that both `handleCommitSplit` print sites (`--plan` and
 * the default preview-then-confirm path) surface the warning before the
 * plan body.
 *
 * `prepareCommitSplitPlan`'s heavy dependencies (staged-diff collection,
 * diff summarization, branch/commitlint context) are mocked so the test
 * exercises the wiring — plan generation through to CLI output — without
 * re-testing plan generation itself (covered by splitPlanGenerator.test.ts).
 */
import { Arguments } from 'yargs'
import { Config } from '../../lib/config/types'
import { CommitOptions } from './config'
import { formatDedupeWarnings, handleCommitSplit, prepareCommitSplitPlan } from './split'
import { DuplicateRescueNote } from './splitPlanValidation'
import { CommitSplitPlan } from './splitPlanTypes'
import { FileChange } from '../../lib/types'
import { Logger } from '../../lib/utils/logger'

jest.mock('../../lib/simple-git/getChanges')
jest.mock('../../lib/parsers/default')
jest.mock('../../lib/simple-git/getCurrentBranchName')
jest.mock('../../lib/utils/hasCommitlintConfig')
jest.mock('./splitPlanGenerator', () => ({
  DEFAULT_MAX_PLAN_ATTEMPTS: 3,
  generateValidatedCommitSplitPlan: jest.fn(),
}))
jest.mock('../../lib/ui/inquirerPrompts')

import { getChanges } from '../../lib/simple-git/getChanges'
import { fileChangeParser } from '../../lib/parsers/default'
import { getCurrentBranchName } from '../../lib/simple-git/getCurrentBranchName'
import { hasCommitlintConfig } from '../../lib/utils/hasCommitlintConfig'
import { generateValidatedCommitSplitPlan } from './splitPlanGenerator'
import { confirmPrompt } from '../../lib/ui/inquirerPrompts'

const mockedGetChanges = getChanges as jest.MockedFunction<typeof getChanges>
const mockedFileChangeParser = fileChangeParser as jest.MockedFunction<typeof fileChangeParser>
const mockedGetCurrentBranchName = getCurrentBranchName as jest.MockedFunction<typeof getCurrentBranchName>
const mockedHasCommitlintConfig = hasCommitlintConfig as jest.MockedFunction<typeof hasCommitlintConfig>
const mockedGenerate = generateValidatedCommitSplitPlan as jest.MockedFunction<
  typeof generateValidatedCommitSplitPlan
>
const mockedConfirmPrompt = confirmPrompt as jest.MockedFunction<typeof confirmPrompt>

const stagedFile = (filePath: string): FileChange => ({
  filePath,
  status: 'added',
  summary: '',
})

const duplicatedPlan: CommitSplitPlan = {
  groups: [
    { title: 'feat: docs', files: ['docs/page.tsx'], hunks: [] },
    { title: 'chore: misc', files: ['package.json'], hunks: [] },
  ],
}

const dedupeWarnings: DuplicateRescueNote[] = [
  {
    kind: 'file',
    id: 'docs/page.tsx',
    keptGroupIndex: 0,
    keptGroupTitle: 'feat: docs',
    droppedGroupIndices: [1],
    droppedGroupTitles: ['chore: misc'],
  },
]

describe('formatDedupeWarnings', () => {
  it('renders each note naming the kept and dropped commits by title', () => {
    const text = formatDedupeWarnings(dedupeWarnings)
    expect(text).toContain('docs/page.tsx')
    expect(text).toContain('kept in "feat: docs"')
    expect(text).toContain('dropped from "chore: misc"')
  })

  it('returns an empty string for no notes', () => {
    expect(formatDedupeWarnings([])).toBe('')
  })
})

describe('prepareCommitSplitPlan / handleCommitSplit — dedupe warnings (#1462)', () => {
  const baseArgv = {
    _: [],
    $0: '',
    split: true,
  } as unknown as Arguments<CommitOptions>

  const baseConfig = {
    service: { provider: 'anthropic', model: 'claude-x' },
  } as unknown as Config & CommitOptions

  beforeEach(() => {
    jest.clearAllMocks()
    mockedGetChanges.mockResolvedValue({
      staged: [stagedFile('docs/page.tsx'), stagedFile('package.json')],
      unstaged: [],
      untracked: [],
    })
    mockedFileChangeParser.mockResolvedValue('condensed diff summary')
    mockedGetCurrentBranchName.mockResolvedValue('feature/docs')
    mockedHasCommitlintConfig.mockResolvedValue(false)
    mockedGenerate.mockResolvedValue({
      plan: duplicatedPlan,
      attempts: 1,
      dedupeWarnings,
    })
  })

  it('prepareCommitSplitPlan surfaces the generator\'s dedupeWarnings', async () => {
    const result = await prepareCommitSplitPlan({
      argv: baseArgv,
      config: baseConfig,
      git: {} as never,
      logger: new Logger({ silent: true }),
      tokenizer: {} as never,
      llm: {} as never,
    })

    if ('empty' in result) throw new Error('expected a plan result')
    expect(result.dedupeWarnings).toEqual(dedupeWarnings)
  })

  it('--plan output includes the dedupe warning before the plan body', async () => {
    const output = await handleCommitSplit({
      argv: { ...baseArgv, plan: true } as Arguments<CommitOptions>,
      config: baseConfig,
      git: {} as never,
      logger: new Logger({ silent: true }),
      tokenizer: {} as never,
      llm: {} as never,
    })

    const warningIndex = output.indexOf('docs/page.tsx: kept in')
    const planIndex = output.indexOf('## 1. feat: docs')
    expect(warningIndex).toBeGreaterThan(-1)
    expect(planIndex).toBeGreaterThan(-1)
    expect(warningIndex).toBeLessThan(planIndex)
  })

  it('default preview path logs the dedupe warning before the plan body', async () => {
    mockedConfirmPrompt.mockResolvedValue(false)
    const logger = new Logger({})
    const logSpy = jest.spyOn(logger, 'log')

    const output = await handleCommitSplit({
      argv: baseArgv,
      config: baseConfig,
      git: {} as never,
      logger,
      tokenizer: {} as never,
      llm: {} as never,
    })

    expect(output).toContain('Split cancelled')
    const loggedLines = logSpy.mock.calls.map((call) => call[0])
    const warningLineIndex = loggedLines.findIndex((line) => line.includes('docs/page.tsx: kept in'))
    const planLineIndex = loggedLines.findIndex((line) => line.includes('## 1. feat: docs'))
    expect(warningLineIndex).toBeGreaterThan(-1)
    expect(planLineIndex).toBeGreaterThan(-1)
    expect(warningLineIndex).toBeLessThan(planLineIndex)
  })
})
