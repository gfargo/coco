import commandExecutor from './commandExecutor'
import { CommandExitError, commandExit, isCommandExitError } from './commandExit'
import { loadConfig } from '../config/utils/loadConfig'

jest.mock('../config/utils/loadConfig')

const mockLoadConfig = loadConfig as jest.MockedFunction<typeof loadConfig>

describe('commandExit', () => {
  const originalExitCode = process.exitCode

  beforeEach(() => {
    process.exitCode = undefined
    mockLoadConfig.mockReturnValue({ silent: true } as never)
  })

  afterEach(() => {
    process.exitCode = originalExitCode
    jest.clearAllMocks()
  })

  it('throws a typed command exit error', () => {
    expect(() => commandExit(7)).toThrow(CommandExitError)

    try {
      commandExit(7)
    } catch (error) {
      expect(isCommandExitError(error)).toBe(true)
      expect(error).toMatchObject({
        code: 7,
      })
    }
  })

  it('lets commandExecutor handle expected command exits without generic failure logging', async () => {
    const handler = jest.fn(async () => {
      commandExit(1)
    })
    const wrapped = commandExecutor(handler)

    await wrapped({
      $0: 'coco',
      _: [],
      interactive: false,
      verbose: false,
      version: false,
      help: false,
    })

    expect(process.exitCode).toBe(1)
  })

  it('maps unexpected errors to a failing exit code', async () => {
    const handler = jest.fn(async () => {
      throw new Error('Unexpected failure')
    })
    const wrapped = commandExecutor(handler)

    await wrapped({
      $0: 'coco',
      _: [],
      interactive: false,
      verbose: false,
      version: false,
      help: false,
    })

    expect(process.exitCode).toBe(1)
  })
})
