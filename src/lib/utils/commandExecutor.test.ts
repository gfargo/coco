import commandExecutor from './commandExecutor'
import { loadConfig } from '../config/utils/loadConfig'
import { Logger } from './logger'
import { CommandHandler } from '../types'

jest.mock('../config/utils/loadConfig')

const mockLoadConfig = loadConfig as jest.MockedFunction<typeof loadConfig>

describe('commandExecutor — global --quiet wiring', () => {
  let logSpy: jest.SpyInstance

  beforeEach(() => {
    mockLoadConfig.mockReturnValue({ verbose: false } as never)
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)
  })

  afterEach(() => {
    logSpy.mockRestore()
    jest.clearAllMocks()
  })

  it('silences logger.log output when --quiet is set', async () => {
    const handler: CommandHandler<never> = async (_argv, logger: Logger) => {
      logger.log('status line')
    }
    await commandExecutor(handler)({ quiet: true } as never)
    expect(logSpy).not.toHaveBeenCalled()
  })

  it('leaves logger.log output intact without --quiet', async () => {
    const handler: CommandHandler<never> = async (_argv, logger: Logger) => {
      logger.log('status line')
    }
    await commandExecutor(handler)({ quiet: false } as never)
    expect(logSpy).toHaveBeenCalled()
  })
})
