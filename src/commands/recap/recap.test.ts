import { Arguments } from 'yargs'
import { handler } from './handler'
import { RecapOptions } from './config'
import { getRepo } from '../../lib/simple-git/getRepo'
import { getChanges } from '../../lib/simple-git/getChanges'
import { getChangesByTimestamp } from '../../lib/simple-git/getChangesByTimestamp'
import { getChangesSinceLastTag } from '../../lib/simple-git/getChangesSinceLastTag'
import { getCurrentBranchName } from '../../lib/simple-git/getCurrentBranchName'
import { getDiffForBranch } from '../../lib/simple-git/getDiffForBranch'
import { fileChangeParser } from '../../lib/parsers/default'
import { executeChain } from '../../lib/langchain/utils/executeChain'
import { Logger } from '../../lib/utils/logger'
import { SimpleGit } from 'simple-git'

jest.mock('../../lib/simple-git/getRepo')
jest.mock('../../lib/simple-git/getChanges')
jest.mock('../../lib/simple-git/getChangesByTimestamp')
jest.mock('../../lib/simple-git/getChangesSinceLastTag')
jest.mock('../../lib/simple-git/getCurrentBranchName')
jest.mock('../../lib/simple-git/getDiffForBranch')
jest.mock('../../lib/parsers/default')
jest.mock('../../lib/langchain/utils/executeChain')
jest.mock('../../lib/ui/generateAndReviewLoop', () => ({
  generateAndReviewLoop: jest.fn().mockImplementation(async ({ factory, parser, agent, noResult, options }) => {
    const changes = await factory();
    if (!changes || (Array.isArray(changes) && changes.length === 0)) {
      await noResult(options);
      return '';
    }
    const context = await parser(changes, '', options);
    return await agent(context, options);
  }),
}));

const mockGetRepo = getRepo as jest.MockedFunction<typeof getRepo>
const mockGetChanges = getChanges as jest.MockedFunction<typeof getChanges>
const mockGetChangesByTimestamp = getChangesByTimestamp as jest.MockedFunction<typeof getChangesByTimestamp>
const mockGetChangesSinceLastTag = getChangesSinceLastTag as jest.MockedFunction<typeof getChangesSinceLastTag>
const mockGetCurrentBranchName = getCurrentBranchName as jest.MockedFunction<typeof getCurrentBranchName>
const mockGetDiffForBranch = getDiffForBranch as jest.MockedFunction<typeof getDiffForBranch>
const mockFileChangeParser = fileChangeParser as jest.MockedFunction<typeof fileChangeParser>
const mockExecuteChain = executeChain as jest.MockedFunction<typeof executeChain>


describe('recap command', () => {
  let argv: Arguments<RecapOptions>
  let logger: Logger

  beforeEach(() => {
    argv = {
      $0: 'coco',
      _: ['recap'],
      interactive: false,
      mode: 'stdout',
      verbose: false,
      version: false,
      help: false,
    }
    logger = {
      log: jest.fn(),
      verbose: jest.fn(),
      setConfig: jest.fn(),
      startTimer: jest.fn().mockReturnThis(),
      stopTimer: jest.fn(),
      startSpinner: jest.fn().mockReturnThis(),
      stopSpinner: jest.fn(),
    } as unknown as Logger

    mockGetRepo.mockReturnValue({} as SimpleGit)
    mockGetChanges.mockResolvedValue({
      staged: [],
      unstaged: [],
      untracked: [],
    })
    mockGetChangesByTimestamp.mockResolvedValue(['mocked timestamp changes'])
    mockGetChangesSinceLastTag.mockResolvedValue(['mocked tag changes'])
    mockGetCurrentBranchName.mockResolvedValue('feature/test-branch')
    mockGetDiffForBranch.mockResolvedValue({
      staged: [{ filePath: 'branch-file.txt', status: 'added', summary: 'branch file summary' }],
      unstaged: [],
      untracked: [],
    })
    mockFileChangeParser.mockResolvedValue('mocked file change summary')
    mockExecuteChain.mockResolvedValue({ title: 'mocked git commit title', summary: 'mocked summary message from git commit message' })
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  it('should call getChanges for current timeframe', async () => {
    await handler(argv, logger)
    expect(mockGetChanges).toHaveBeenCalled()
  })

  it('should call getChangesByTimestamp for yesterday', async () => {
    argv.yesterday = true
    await handler(argv, logger)
    expect(mockGetChangesByTimestamp).toHaveBeenCalled()
  })

  it('should call getChangesByTimestamp for last-week', async () => {
    argv['last-week'] = true
    await handler(argv, logger)
    expect(mockGetChangesByTimestamp).toHaveBeenCalled()
  })

  it('should call getChangesByTimestamp for last-month', async () => {
    argv['last-month'] = true
    await handler(argv, logger)
    expect(mockGetChangesByTimestamp).toHaveBeenCalled()
  })

  it('should call getChangesSinceLastTag for last-tag', async () => {
    argv['last-tag'] = true
    await handler(argv, logger)
    expect(mockGetChangesSinceLastTag).toHaveBeenCalled()
  })

  it('should call getDiffForBranch for currentBranch', async () => {
    argv.currentBranch = true
    await handler(argv, logger)
    expect(mockGetDiffForBranch).toHaveBeenCalledWith(expect.objectContaining({
      baseBranch: 'main',
      headBranch: 'feature/test-branch',
    }))
  })

  it('should pass correct changes to parser for currentBranch', async () => {
    argv.currentBranch = true
    await handler(argv, logger)
    expect(mockFileChangeParser).toHaveBeenCalledWith(expect.objectContaining({
      changes: [
        { filePath: 'branch-file.txt', status: 'added', summary: 'branch file summary' },
      ],
    }))
  })
})