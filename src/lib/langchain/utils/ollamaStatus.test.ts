import { execPromise } from '../../utils/execPromise'
import {
  DEFAULT_OLLAMA_ENDPOINT,
  getOllamaStatus,
  OllamaNotReadyError,
  RECOMMENDED_STARTER_MODEL,
} from './ollamaStatus'

jest.mock('../../utils/execPromise')

const mockExecPromise = execPromise as jest.MockedFunction<typeof execPromise>

function mockFetchOnce(impl: () => Promise<unknown> | never) {
  ;(global as unknown as { fetch: jest.Mock }).fetch = jest.fn(impl as never)
}

describe('getOllamaStatus', () => {
  afterEach(() => {
    jest.restoreAllMocks()
    jest.clearAllMocks()
  })

  it('reports reachable + pulled models when the daemon responds', async () => {
    mockFetchOnce(async () => ({
      ok: true,
      json: async () => ({
        models: [{ name: 'llama3.1:8b' }, { name: 'qwen2.5-coder:7b' }, { name: '' }],
      }),
    }))

    const status = await getOllamaStatus()

    expect(status.reachable).toBe(true)
    expect(status.installed).toBe(true)
    // empty / missing names are filtered out
    expect(status.models).toEqual(['llama3.1:8b', 'qwen2.5-coder:7b'])
    // a reachable daemon never needs the PATH probe
    expect(mockExecPromise).not.toHaveBeenCalled()
  })

  it('distinguishes installed-but-not-running from not-installed when unreachable', async () => {
    mockFetchOnce(async () => {
      throw new Error('ECONNREFUSED')
    })
    mockExecPromise.mockResolvedValue({ stdout: '/usr/local/bin/ollama', stderr: '' })

    const status = await getOllamaStatus()

    expect(status.reachable).toBe(false)
    expect(status.installed).toBe(true) // binary on PATH
    expect(status.models).toEqual([])
  })

  it('reports not installed when unreachable and the binary is absent', async () => {
    mockFetchOnce(async () => {
      throw new Error('ECONNREFUSED')
    })
    mockExecPromise.mockRejectedValue('not found')

    const status = await getOllamaStatus()

    expect(status.reachable).toBe(false)
    expect(status.installed).toBe(false)
  })

  it('treats a non-OK response as unreachable', async () => {
    mockFetchOnce(async () => ({ ok: false, json: async () => ({}) }))
    mockExecPromise.mockRejectedValue('not found')

    const status = await getOllamaStatus()

    expect(status.reachable).toBe(false)
  })

  it('strips trailing slashes from the endpoint when building the tags URL', async () => {
    const fetchMock = jest.fn(async () => ({ ok: true, json: async () => ({ models: [] }) }))
    ;(global as unknown as { fetch: jest.Mock }).fetch = fetchMock as never

    await getOllamaStatus('http://localhost:11434/')

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:11434/api/tags',
      expect.any(Object),
    )
  })
})

describe('constants + error', () => {
  it('exposes a localhost default endpoint and a small starter model', () => {
    expect(DEFAULT_OLLAMA_ENDPOINT).toBe('http://localhost:11434')
    expect(RECOMMENDED_STARTER_MODEL).toBe('llama3.1:8b')
  })

  it('OllamaNotReadyError is a named Error', () => {
    const err = new OllamaNotReadyError()
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('OllamaNotReadyError')
  })
})
