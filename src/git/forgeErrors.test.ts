import { compactCliError, resolveForgeActionError } from './forgeErrors'
import type { GhStatus } from './githubCli'

describe('forgeErrors', () => {
  describe('compactCliError', () => {
    it('keeps the head line and bounds detail lines to 7', () => {
      const message = ['head', ...Array.from({ length: 12 }, (_, i) => `line ${i}`)].join('\n')
      const result = compactCliError(message, { fallback: 'fallback' })
      expect(result.message).toBe('head')
      expect(result.details).toHaveLength(7)
    })

    it('falls back to the given fallback for empty input', () => {
      expect(compactCliError('   ', { fallback: 'CLI command failed.' })).toEqual({
        message: 'CLI command failed.',
        details: [],
      })
    })

    it('drops the echoed command line and leads with the real reason', () => {
      const message = [
        'Command failed: glab mr create --title=T --description=huge',
        'a merge request for branch "feat/x" already exists:',
        'https://gitlab.com/gfargo/coco/-/merge_requests/9',
      ].join('\n')
      const result = compactCliError(message, { fallback: 'GitLab CLI command failed.' })
      expect(result.message).toBe('a merge request for branch "feat/x" already exists:')
      expect(result.details).toEqual(['https://gitlab.com/gfargo/coco/-/merge_requests/9'])
    })
  })

  describe('resolveForgeActionError', () => {
    it('returns the curated hint when the probe reports a non-ok status', async () => {
      const probe = jest.fn().mockResolvedValue({ kind: 'not-authenticated' } satisfies GhStatus)
      const describe = jest.fn().mockReturnValue('Run `glab auth login`.')
      const result = await resolveForgeActionError(new Error('mr create failed'), {
        probe,
        describe,
        fallback: 'GitLab CLI command failed.',
      })
      expect(result.message).toBe('Run `glab auth login`.')
    })

    it('compacts the raw error when the probe reports ok', async () => {
      const probe = jest.fn().mockResolvedValue({ kind: 'ok' } satisfies GhStatus)
      const describe = jest.fn()
      const result = await resolveForgeActionError(
        new Error('Merge request already exists\ntry a different branch'),
        { probe, describe, fallback: 'GitLab CLI command failed.' }
      )
      expect(result.message).toBe('Merge request already exists')
      expect(result.details).toEqual(['try a different branch'])
    })

    it('falls back to compacting the raw error when the probe itself throws', async () => {
      const probe = jest.fn().mockRejectedValue(new Error('probe unavailable'))
      const describe = jest.fn()
      const result = await resolveForgeActionError(new Error('Bitbucket API error 500: boom'), {
        probe,
        describe,
        fallback: 'Bitbucket API call failed.',
      })
      expect(result.message).toBe('Bitbucket API error 500: boom')
    })

    it('prefers attached stderr over the echoed command in message', async () => {
      const probe = jest.fn().mockResolvedValue({ kind: 'ok' } satisfies GhStatus)
      const describe = jest.fn()
      const error = Object.assign(
        new Error('Command failed: glab mr create --description=huge'),
        { stderr: 'pipeline failed for merge request\n' }
      )
      const result = await resolveForgeActionError(error, {
        probe,
        describe,
        fallback: 'GitLab CLI command failed.',
      })
      expect(result.message).toBe('pipeline failed for merge request')
    })
  })
})
