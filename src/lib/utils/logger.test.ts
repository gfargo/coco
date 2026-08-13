import { Logger } from './logger'

describe('Logger.result (#1879)', () => {
  it('writes to stdout even when quiet is set', () => {
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
    try {
      const logger = new Logger({ quiet: true })
      logger.result('the actual output')
      expect(spy).toHaveBeenCalledWith('the actual output\n')
    } finally {
      spy.mockRestore()
    }
  })

  it('writes to stdout even when silent is set', () => {
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
    try {
      const logger = new Logger({ silent: true })
      logger.result('the actual output')
      expect(spy).toHaveBeenCalledWith('the actual output\n')
    } finally {
      spy.mockRestore()
    }
  })

  it('does not color the message by default', () => {
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
    try {
      const logger = new Logger({})
      logger.result('plain')
      expect(spy).toHaveBeenCalledWith('plain\n')
    } finally {
      spy.mockRestore()
    }
  })
})

describe('Logger.log still honors quiet/silent (regression guard)', () => {
  it('suppresses log() output under quiet', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => undefined)
    try {
      const logger = new Logger({ quiet: true })
      logger.log('chrome')
      expect(spy).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })
})
