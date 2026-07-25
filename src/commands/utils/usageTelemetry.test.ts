import { resolveRepoIdentifier } from '../../git/repoIdentifier'
import { loadConfig } from '../../lib/config/utils/loadConfig'
import {
  isUsageLoggingEnabled,
  setUsageConfigPreference,
  setUsageRepoTag,
} from '../../lib/langchain/utils/usageLedger'
import {
  applyUsageRepoTag,
  armNonInteractiveUsagePreference,
  armNonInteractiveUsageTelemetry,
} from './usageTelemetry'

jest.mock('../../git/repoIdentifier', () => ({
  resolveRepoIdentifier: jest.fn(),
}))
jest.mock('../../lib/config/utils/loadConfig', () => ({
  loadConfig: jest.fn(),
}))
jest.mock('../../lib/langchain/utils/usageLedger', () => ({
  isUsageLoggingEnabled: jest.fn(),
  setUsageConfigPreference: jest.fn(),
  setUsageRepoTag: jest.fn(),
}))

const mockLoadConfig = loadConfig as jest.MockedFunction<typeof loadConfig>
const mockResolveRepoIdentifier = resolveRepoIdentifier as jest.MockedFunction<typeof resolveRepoIdentifier>
const mockIsUsageLoggingEnabled = isUsageLoggingEnabled as jest.MockedFunction<typeof isUsageLoggingEnabled>
const mockSetUsageConfigPreference = setUsageConfigPreference as jest.MockedFunction<typeof setUsageConfigPreference>
const mockSetUsageRepoTag = setUsageRepoTag as jest.MockedFunction<typeof setUsageRepoTag>

describe('armNonInteractiveUsageTelemetry', () => {
  const argv = { _: ['agent'], $0: 'coco', quiet: true }

  beforeEach(() => {
    jest.clearAllMocks()
    mockLoadConfig.mockReturnValue({ telemetry: { usage: true } } as never)
    mockIsUsageLoggingEnabled.mockReturnValue(true)
    mockResolveRepoIdentifier.mockResolvedValue('gfargo/coco')
  })

  it('uses only the existing config preference and records a metadata-only repo tag', async () => {
    await armNonInteractiveUsageTelemetry(argv, '/repo')

    expect(mockLoadConfig).toHaveBeenCalledWith(argv)
    expect(mockSetUsageConfigPreference).toHaveBeenCalledWith(true)
    expect(mockIsUsageLoggingEnabled).toHaveBeenCalledTimes(1)
    expect(mockResolveRepoIdentifier).toHaveBeenCalledWith({ cwd: '/repo' })
    expect(mockSetUsageRepoTag).toHaveBeenCalledWith('gfargo/coco')
  })

  it('does not inspect the repository when existing preference/env gating leaves logging off', async () => {
    mockLoadConfig.mockReturnValue({ telemetry: { usage: false } } as never)
    mockIsUsageLoggingEnabled.mockReturnValue(false)

    await armNonInteractiveUsageTelemetry(argv, '/repo')

    expect(mockSetUsageConfigPreference).toHaveBeenCalledWith(false)
    expect(mockResolveRepoIdentifier).not.toHaveBeenCalled()
    expect(mockSetUsageRepoTag).toHaveBeenCalledWith(undefined)
  })

  it('allows the environment-aware ledger gate to enable logging despite a disabled preference', async () => {
    mockLoadConfig.mockReturnValue({ telemetry: { usage: false } } as never)
    mockIsUsageLoggingEnabled.mockReturnValue(true)

    await armNonInteractiveUsageTelemetry(argv, '/repo')

    expect(mockSetUsageConfigPreference).toHaveBeenCalledWith(false)
    expect(mockResolveRepoIdentifier).toHaveBeenCalledWith({ cwd: '/repo' })
    expect(mockSetUsageRepoTag).toHaveBeenCalledWith('gfargo/coco')
  })

  it('never lets config or repository lookup failures interrupt the command transport', async () => {
    mockLoadConfig.mockImplementationOnce(() => { throw new Error('config failed') })
    await expect(armNonInteractiveUsageTelemetry(argv, '/repo')).resolves.toBeUndefined()

    mockLoadConfig.mockReturnValue({ telemetry: { usage: true } } as never)
    mockResolveRepoIdentifier.mockRejectedValueOnce(new Error('git failed'))
    await expect(armNonInteractiveUsageTelemetry(argv, '/repo')).resolves.toBeUndefined()
  })
})

describe('armNonInteractiveUsagePreference', () => {
  const argv = { _: ['mcp'], $0: 'coco' }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('sets the config preference without touching repository resolution', () => {
    mockLoadConfig.mockReturnValue({ telemetry: { usage: true } } as never)

    armNonInteractiveUsagePreference(argv)

    expect(mockLoadConfig).toHaveBeenCalledWith(argv)
    expect(mockSetUsageConfigPreference).toHaveBeenCalledWith(true)
    expect(mockResolveRepoIdentifier).not.toHaveBeenCalled()
    expect(mockSetUsageRepoTag).not.toHaveBeenCalled()
  })

  it('never lets a config load failure interrupt the caller', () => {
    mockLoadConfig.mockImplementationOnce(() => { throw new Error('config failed') })

    expect(() => armNonInteractiveUsagePreference(argv)).not.toThrow()
  })
})

describe('applyUsageRepoTag', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockIsUsageLoggingEnabled.mockReturnValue(true)
    mockResolveRepoIdentifier.mockResolvedValue('gfargo/coco')
  })

  it('resolves and stamps the repo identifier when logging is enabled', async () => {
    await applyUsageRepoTag('/repo')

    expect(mockResolveRepoIdentifier).toHaveBeenCalledWith({ cwd: '/repo' })
    expect(mockSetUsageRepoTag).toHaveBeenCalledWith('gfargo/coco')
  })

  it('sets an undefined tag without resolving the repo when logging is disabled', async () => {
    mockIsUsageLoggingEnabled.mockReturnValue(false)

    await applyUsageRepoTag('/repo')

    expect(mockResolveRepoIdentifier).not.toHaveBeenCalled()
    expect(mockSetUsageRepoTag).toHaveBeenCalledWith(undefined)
  })

  it('swallows a repository lookup failure', async () => {
    mockResolveRepoIdentifier.mockRejectedValueOnce(new Error('git failed'))

    await expect(applyUsageRepoTag('/repo')).resolves.toBeUndefined()
  })
})
