import { withRetry, withTimeout, withRetryAndTimeout } from './retry'

describe('retry utilities', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('withRetry', () => {
    it('should succeed on first attempt', async () => {
      const operation = jest.fn().mockResolvedValue('success')
      
      const result = await withRetry(operation)
      
      expect(result).toBe('success')
      expect(operation).toHaveBeenCalledTimes(1)
    })

    it('should retry on failure and succeed', async () => {
      const operation = jest.fn()
        .mockRejectedValueOnce(new Error('First failure'))
        .mockResolvedValueOnce('success')
      
      const result = await withRetry(operation, { maxAttempts: 3 })
      
      expect(result).toBe('success')
      expect(operation).toHaveBeenCalledTimes(2)
    })

    it('should fail after max attempts', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('Always fails'))
      
      await expect(withRetry(operation, { maxAttempts: 2 })).rejects.toThrow('Always fails')
      expect(operation).toHaveBeenCalledTimes(2)
    })

    it('should call onRetry callback', async () => {
      const operation = jest.fn()
        .mockRejectedValueOnce(new Error('First failure'))
        .mockResolvedValueOnce('success')
      
      const onRetry = jest.fn()
      
      await withRetry(operation, { maxAttempts: 3, onRetry })
      
      expect(onRetry).toHaveBeenCalledTimes(1)
      expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error), expect.any(Number))
    })

    it('should respect shouldRetry predicate', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('ValidationError'))
      const shouldRetry = jest.fn().mockReturnValue(false)

      await expect(withRetry(operation, { shouldRetry })).rejects.toThrow('ValidationError')
      expect(operation).toHaveBeenCalledTimes(1)
      expect(shouldRetry).toHaveBeenCalledWith(expect.any(Error))
    })

    it('never retries a user cancellation by default', async () => {
      // A cancelled LLM call (LangChainCancelledError) is intent, not a
      // transient failure — the default predicate must not re-issue it.
      const cancelled = new Error('user cancelled')
      cancelled.name = 'LangChainCancelledError'
      const operation = jest.fn().mockRejectedValue(cancelled)

      await expect(withRetry(operation, { maxAttempts: 3, backoffMs: 1 })).rejects.toThrow(
        'user cancelled'
      )
      expect(operation).toHaveBeenCalledTimes(1)
    })

    it('never retries a schema parse failure by default (#1460 / OSS-503)', async () => {
      // Retrying the identical prompt+model rarely produces different
      // output — the default predicate must not re-bill the same call.
      const err = new Error('bad json')
      err.name = 'LangChainSchemaParseError'
      const operation = jest.fn().mockRejectedValue(err)

      await expect(withRetry(operation, { maxAttempts: 3, backoffMs: 1 })).rejects.toThrow(
        'bad json'
      )
      expect(operation).toHaveBeenCalledTimes(1)
    })
  })

  describe('withTimeout', () => {
    it('should succeed within timeout', async () => {
      const operation = jest.fn().mockResolvedValue('success')
      
      const result = await withTimeout(operation, 1000, 'test')
      
      expect(result).toBe('success')
    })

    it('should timeout if operation takes too long', async () => {
      const operation = jest.fn().mockImplementation(() => 
        new Promise(resolve => setTimeout(() => resolve('success'), 2000))
      )
      
      await expect(withTimeout(operation, 100, 'test')).rejects.toThrow('timed out after 100ms')
    })
  })

  describe('withRetryAndTimeout', () => {
    it('should combine retry and timeout correctly', async () => {
      const operation = jest.fn()
        .mockRejectedValueOnce(new Error('First failure'))
        .mockResolvedValueOnce('success')
      
      const result = await withRetryAndTimeout(
        operation, 
        { maxAttempts: 3 }, 
        1000, 
        'test'
      )
      
      expect(result).toBe('success')
      expect(operation).toHaveBeenCalledTimes(2)
    })
  })
})