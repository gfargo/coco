import { salvageCommitMessageFromText } from './salvageCommitMessage'

describe('salvageCommitMessageFromText', () => {
  it('parses a fenced JSON block', () => {
    const text = '```json\n{"title": "fix(auth): handle expired tokens", "body": "Refresh before expiry."}\n```'
    expect(salvageCommitMessageFromText(text)).toEqual({
      title: 'fix(auth): handle expired tokens',
      body: 'Refresh before expiry.',
    })
  })

  it('recovers JSON prefixed with prose and no fence', () => {
    const text = 'Here is your commit: {"title": "feat(api): add retry", "body": "Adds exponential backoff."}'
    expect(salvageCommitMessageFromText(text)).toEqual({
      title: 'feat(api): add retry',
      body: 'Adds exponential backoff.',
    })
  })

  it('recovers JSON prefixed with prose and followed by trailing prose', () => {
    const text = 'Sure! {"title": "chore: bump deps", "body": "Routine update."} Let me know if you need anything else.'
    expect(salvageCommitMessageFromText(text)).toEqual({
      title: 'chore: bump deps',
      body: 'Routine update.',
    })
  })

  it('handles a body value containing a closing brace before the true end of the object', () => {
    const text = '{"title": "fix(parser): handle stray }", "body": "See the { } case in the tokenizer."}'
    expect(salvageCommitMessageFromText(text)).toEqual({
      title: 'fix(parser): handle stray }',
      body: 'See the { } case in the tokenizer.',
    })
  })

  it('handles an escaped quote inside a string value', () => {
    const text = '{"title": "fix: handle \\"quoted\\" input", "body": "Body text."}'
    expect(salvageCommitMessageFromText(text)).toEqual({
      title: 'fix: handle "quoted" input',
      body: 'Body text.',
    })
  })

  it('falls back to first-line-as-title when no valid JSON is present', () => {
    const text = 'Add user authentication\nImplements JWT-based login and logout.'
    expect(salvageCommitMessageFromText(text)).toEqual({
      title: 'Add user authentication',
      body: 'Implements JWT-based login and logout.',
    })
  })

  it('falls back to the placeholder title for empty text', () => {
    expect(salvageCommitMessageFromText('')).toEqual({
      title: 'Auto-generated commit',
      body: 'Generated commit message',
    })
  })

  it('ignores JSON missing the required title/body shape and falls back to line-split', () => {
    const text = '{"foo": "bar"}'
    expect(salvageCommitMessageFromText(text)).toEqual({
      title: '{"foo": "bar"}',
      body: 'Generated commit message',
    })
  })
})
