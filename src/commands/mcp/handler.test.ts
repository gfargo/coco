import { startCocoMcpServer } from '../../mcp/server'
import { handler } from './handler'

const mockArmNonInteractiveUsageTelemetry = jest.fn()
const mockResolveAgentRepoRoot = jest.fn()

jest.mock('../utils/usageTelemetry', () => ({
  armNonInteractiveUsageTelemetry: (...args: unknown[]) => Promise.resolve(mockArmNonInteractiveUsageTelemetry(...args)),
}))
jest.mock('../../mcp/server', () => ({
  startCocoMcpServer: jest.fn(),
}))
jest.mock('../../operations/agent', () => {
  return { resolveAgentRepoRoot: (...args: unknown[]) => mockResolveAgentRepoRoot(...args) }
})

const mockStartCocoMcpServer = startCocoMcpServer as jest.MockedFunction<typeof startCocoMcpServer>

describe('mcp command handler', () => {
  let chdirSpy: jest.SpyInstance

  beforeEach(() => {
    jest.clearAllMocks()
    chdirSpy = jest.spyOn(process, 'chdir').mockImplementation(() => undefined)
    mockResolveAgentRepoRoot.mockResolvedValue('/bound/repo')
    mockStartCocoMcpServer.mockResolvedValue(undefined)
  })

  afterEach(() => {
    chdirSpy.mockRestore()
  })

  it('binds cwd, privacy-safe telemetry, and the server to one resolved repository', async () => {
    const argv = { $0: 'coco', _: ['mcp'], repo: '/requested/repo', quiet: true } as never

    await handler(argv)

    expect(mockResolveAgentRepoRoot).toHaveBeenCalledWith('/requested/repo')
    expect(chdirSpy).toHaveBeenCalledWith('/bound/repo')
    expect(mockArmNonInteractiveUsageTelemetry).toHaveBeenCalledWith(argv, '/bound/repo')
    expect(mockStartCocoMcpServer).toHaveBeenCalledWith('/bound/repo')
  })

  it('does not start the server when repository resolution fails', async () => {
    mockResolveAgentRepoRoot.mockRejectedValueOnce(new Error('not a repository'))

    await expect(handler({ $0: 'coco', _: ['mcp'] } as never)).rejects.toThrow('not a repository')

    expect(chdirSpy).not.toHaveBeenCalled()
    expect(mockArmNonInteractiveUsageTelemetry).not.toHaveBeenCalled()
    expect(mockStartCocoMcpServer).not.toHaveBeenCalled()
  })

  it('waits for telemetry arming before starting the stdio server', async () => {
    const order: string[] = []
    mockArmNonInteractiveUsageTelemetry.mockImplementationOnce(async () => { order.push('telemetry') })
    mockStartCocoMcpServer.mockImplementationOnce(async () => { order.push('server') })

    await handler({ $0: 'coco', _: ['mcp'] } as never)

    expect(order).toEqual(['telemetry', 'server'])
  })
})
