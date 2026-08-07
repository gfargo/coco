jest.mock('./statusHandler', () => ({
  statusHandler: jest.fn(),
}))

import { handler } from './handler'
import { statusHandler } from './statusHandler'

const mockedStatusHandler = statusHandler as jest.MockedFunction<typeof statusHandler>

describe('coco resolve <subcommand> dispatcher', () => {
  let logger: { log: jest.Mock; error: jest.Mock }

  beforeEach(() => {
    logger = { log: jest.fn(), error: jest.fn() }
    mockedStatusHandler.mockReset()
    mockedStatusHandler.mockResolvedValue(undefined)
  })

  it('routes "status" to statusHandler', async () => {
    const argv = { subcommand: 'status' } as never
    await handler(argv, logger as never)
    expect(mockedStatusHandler).toHaveBeenCalledWith(argv, logger)
  })

  it('"explain" is stubbed and exits non-zero', async () => {
    await expect(
      handler({ subcommand: 'explain' } as never, logger as never)
    ).rejects.toMatchObject({ name: 'CommandExitError', code: 1 })
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('not yet implemented'), expect.anything())
  })

  it('default resolve mode (no subcommand) is stubbed and exits non-zero', async () => {
    await expect(
      handler({} as never, logger as never)
    ).rejects.toMatchObject({ name: 'CommandExitError', code: 1 })
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('not yet implemented'), expect.anything())
  })
})
