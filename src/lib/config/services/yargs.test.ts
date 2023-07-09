import { Config } from '../types'
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { loadCmdLineFlags } from './yargs'

jest.mock('yargs', () => {
  interface YargsMock {
    argv: {
      openAIApiKey: string
      tokenLimit: number
    }
    options: jest.Mock<YargsMock, []>
    parseSync: jest.Mock<YargsMock['argv']>
  }

  const yargsMock: YargsMock = {
    argv: {
      openAIApiKey: 'cmdLineApiKey',
      tokenLimit: 450,
    },
    options: jest.fn(() => yargsMock),
    parseSync: jest.fn(() => yargsMock.argv),
  }

  return jest.fn(() => yargsMock)
})

jest.mock('yargs/helpers', () => ({
  hideBin: jest.fn((processArgv) => processArgv),
}))


const defaultConfig: Config = {
  model: 'openai/gpt-3.5-turbo',
  openAIApiKey: 'sk_test_1234',
  temperature: 0.4,
  tokenLimit: 150,
  ignoredFiles: ['package-lock.json'],
  ignoredExtensions: ['.map', '.lock'],
}

describe('loadCmdLineFlags', () => {
  afterEach(() => {
    jest.resetAllMocks()
  })

  it('should load command line flags', () => {
    const config = loadCmdLineFlags(defaultConfig)
    expect(config.openAIApiKey).toBe('cmdLineApiKey')
    expect(config.tokenLimit).toBe(450) // cmd line flag should overwrite default
  })
})
