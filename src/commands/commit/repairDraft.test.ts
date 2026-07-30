/**
 * Unit tests for repairDraftAgainstValidationErrors (OSS-1326 / #1854).
 *
 * The function is a pure transformation so these tests are straightforward:
 * no mocks, no async, just string-in / string-out assertions.
 */

import { repairDraftAgainstValidationErrors } from './generateCommitDraft'

describe('repairDraftAgainstValidationErrors', () => {
  describe('body-max-line-length repair', () => {
    it('wraps a body line that exceeds 100 characters', () => {
      const longLine = 'word '.repeat(22).trimEnd() // 110 chars
      const draft = `chore: update\n\n${longLine}`
      const result = repairDraftAgainstValidationErrors(draft, [
        "body's lines must not be longer than 100 characters",
      ])
      const bodyLines = result.split('\n\n')[1].split('\n')
      for (const line of bodyLines) {
        expect(line.length).toBeLessThanOrEqual(100)
      }
    })

    it('preserves the title unchanged when only the body is over-length', () => {
      const draft = `fix(auth): handle token expiry\n\n${'a '.repeat(60)}`
      const result = repairDraftAgainstValidationErrors(draft, [
        "body's lines must not be longer than 100 characters",
      ])
      expect(result.split('\n\n')[0]).toBe('fix(auth): handle token expiry')
    })

    it('respects the limit extracted from the error message', () => {
      const longLine = 'x '.repeat(40).trimEnd() // 79 chars
      const draft = `chore: bump\n\n${longLine}`
      const result = repairDraftAgainstValidationErrors(draft, [
        "body's lines must not be longer than 72 characters",
      ])
      const bodyLines = result.split('\n\n')[1].split('\n')
      for (const line of bodyLines) {
        expect(line.length).toBeLessThanOrEqual(72)
      }
    })

    it('does not alter lines that are already within the limit', () => {
      const draft = 'chore: test\n\nShort body.'
      const result = repairDraftAgainstValidationErrors(draft, [
        "body's lines must not be longer than 100 characters",
      ])
      expect(result).toBe(draft)
    })

    it('preserves multiple body lines and only wraps the offending ones', () => {
      const shortLine = 'This is fine.'
      const longLine = 'This line is deliberately written to exceed the one hundred character limit enforced by commitlint rules.'
      expect(longLine.length).toBeGreaterThan(100)
      const draft = `chore: test\n\n${shortLine}\n${longLine}`
      const result = repairDraftAgainstValidationErrors(draft, [
        "body's lines must not be longer than 100 characters",
      ])
      const bodyLines = result.split('\n\n')[1].split('\n')
      expect(bodyLines[0]).toBe(shortLine)
      for (const line of bodyLines) {
        expect(line.length).toBeLessThanOrEqual(100)
      }
    })
  })

  describe('header-max-length repair', () => {
    it('truncates a header that exceeds 72 characters at a word boundary', () => {
      const longTitle = `feat(agent): ${'word '.repeat(15).trimEnd()}` // well over 72 chars
      const draft = `${longTitle}\n\nBody text.`
      const result = repairDraftAgainstValidationErrors(draft, [
        'header must not be longer than 72 characters',
      ])
      const title = result.split('\n\n')[0]
      expect(title.length).toBeLessThanOrEqual(72)
      expect(longTitle.startsWith(title)).toBe(true)
    })

    it('respects the limit extracted from the error message', () => {
      const longTitle = `chore: ${'x '.repeat(30).trimEnd()}`
      const result = repairDraftAgainstValidationErrors(longTitle, [
        'header must not be longer than 40 characters',
      ])
      expect(result.length).toBeLessThanOrEqual(40)
    })

    it('does not alter a header that is already within the limit', () => {
      const draft = 'chore: test\n\nShort body.'
      const result = repairDraftAgainstValidationErrors(draft, [
        'header must not be longer than 72 characters',
      ])
      expect(result).toBe(draft)
    })

    it('does not cut into a single very long token', () => {
      const longToken = 'a'.repeat(90)
      const draft = `chore: ${longToken}`
      const result = repairDraftAgainstValidationErrors(draft, [
        'header must not be longer than 72 characters',
      ])
      expect(result.length).toBeLessThanOrEqual(72)
      // The subject must survive the hard cut rather than being collapsed
      // down to just the `type(scope):` prefix.
      expect(result).not.toBe('chore:')
      expect(result.startsWith('chore: a')).toBe(true)
    })
  })

  describe('subject-case repair', () => {
    it('lowercases the first character of an uppercase subject', () => {
      const draft = 'feat(auth): Add OAuth support\n\nImplements the flow.'
      const result = repairDraftAgainstValidationErrors(draft, [
        'subject must be sentence-case, start-case, pascal-case, upper-case, lower-case',
      ])
      expect(result.split('\n\n')[0]).toBe('feat(auth): add OAuth support')
    })

    it('lowercases the subject in a scope-less conventional commit', () => {
      const draft = 'fix: Apply the patch\n\nDetails.'
      const result = repairDraftAgainstValidationErrors(draft, ['subject-case'])
      expect(result.split('\n\n')[0]).toBe('fix: apply the patch')
    })

    it('does not alter an already lowercase subject', () => {
      const draft = 'feat: add something\n\nbody'
      const result = repairDraftAgainstValidationErrors(draft, ['subject-case'])
      expect(result.split('\n\n')[0]).toBe('feat: add something')
    })

    it('handles a breaking-change marker in the type', () => {
      const draft = 'feat!: Remove the legacy API\n\nBreaking.'
      const result = repairDraftAgainstValidationErrors(draft, ['subject-case'])
      expect(result.split('\n\n')[0]).toBe('feat!: remove the legacy API')
    })
  })

  describe('combined repairs', () => {
    it('applies both subject-case and body-line-length repairs in one call', () => {
      const longLine = 'word '.repeat(22).trimEnd()
      const draft = `feat: Add many things\n\n${longLine}`
      const result = repairDraftAgainstValidationErrors(draft, [
        'subject must be sentence-case, start-case, pascal-case, upper-case, lower-case',
        "body's lines must not be longer than 100 characters",
      ])
      expect(result.split('\n\n')[0]).toBe('feat: add many things')
      const bodyLines = result.split('\n\n')[1].split('\n')
      for (const line of bodyLines) {
        expect(line.length).toBeLessThanOrEqual(100)
      }
    })
  })

  describe('no-op cases', () => {
    it('returns the original draft when errors array is empty', () => {
      const draft = 'feat: do something\n\nbody'
      expect(repairDraftAgainstValidationErrors(draft, [])).toBe(draft)
    })

    it('returns the original draft when errors do not match any known repair rule', () => {
      const draft = 'invalid-type: something\n\nbody'
      expect(
        repairDraftAgainstValidationErrors(draft, ['type must be one of [feat, fix, chore, …]'])
      ).toBe(draft)
    })

    it('returns the original draft when draft is empty', () => {
      expect(repairDraftAgainstValidationErrors('', ['subject-case'])).toBe('')
    })
  })
})
