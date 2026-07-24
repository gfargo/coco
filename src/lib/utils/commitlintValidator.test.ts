import { validateConventionalCommitMessage } from './commitlintValidator'

describe('validateConventionalCommitMessage', () => {
  it('accepts a conventional message using built-in rules', async () => {
    await expect(validateConventionalCommitMessage(
      'feat(agent): expose structured generation',
    )).resolves.toMatchObject({
      valid: true,
      errors: [],
    })
  })

  it('rejects a non-conventional title without loading repository config', async () => {
    const result = await validateConventionalCommitMessage('Expose structured generation')

    expect(result.valid).toBe(false)
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringMatching(/type may not be empty/i),
    ]))
  })
})
