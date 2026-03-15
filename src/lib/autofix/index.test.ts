import { runAutoFix } from './index'
import { ReviewFeedbackItem } from '../../commands/review/config'
import { AutoFixConfig } from './types'

// Mock buildPrompt
jest.mock('./buildPrompt', () => ({
  buildPrompt: jest.fn().mockResolvedValue('mocked prompt'),
}))

// Mock CodexAdapter — use a module-level variable set inside the factory
jest.mock('./adapters/codex', () => {
  const run = jest.fn().mockResolvedValue(undefined)
  return {
    CodexAdapter: jest.fn().mockImplementation(() => ({ run })),
    __mockRun: run,
  }
})

const item: ReviewFeedbackItem = {
  title: 'Missing null check',
  summary: 'The function does not handle null input',
  severity: 7,
  category: 'bug',
  filePath: 'src/foo.ts',
}

describe('runAutoFix', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockRun: jest.Mock
  let buildPrompt: jest.Mock

  beforeEach(async () => {
    jest.clearAllMocks()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const codexModule = await import('./adapters/codex') as unknown as { __mockRun: jest.Mock }
    mockRun = codexModule.__mockRun
    mockRun.mockResolvedValue(undefined)
    const promptModule = await import('./buildPrompt') as unknown as { buildPrompt: jest.Mock }
    buildPrompt = promptModule.buildPrompt
  })

  it('is a no-op when autoFixTool is unset', async () => {
    const config: AutoFixConfig = {}

    await expect(runAutoFix(item, config)).resolves.toBeUndefined()
    expect(buildPrompt).not.toHaveBeenCalled()
    expect(mockRun).not.toHaveBeenCalled()
  })

  it('throws on unrecognized autoFixTool', async () => {
    const config: AutoFixConfig = { autoFixTool: 'unknown-tool' }

    await expect(runAutoFix(item, config)).rejects.toThrow('Unknown autoFixTool: "unknown-tool"')
  })

  it('resolves the correct adapter and calls run with the built prompt and options', async () => {
    const options = { model: 'o4-mini' }
    const config: AutoFixConfig = { autoFixTool: 'codex', autoFixToolOptions: options }

    await runAutoFix(item, config)

    expect(buildPrompt).toHaveBeenCalledWith(item)
    expect(mockRun).toHaveBeenCalledWith('mocked prompt', options, undefined)
  })

  it('calls run without options when autoFixToolOptions is unset', async () => {
    const config: AutoFixConfig = { autoFixTool: 'codex' }

    await runAutoFix(item, config)

    expect(buildPrompt).toHaveBeenCalledWith(item)
    expect(mockRun).toHaveBeenCalledWith('mocked prompt', undefined, undefined)
  })
})
