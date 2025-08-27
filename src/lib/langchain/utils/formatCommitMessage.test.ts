import { formatCommitMessage } from './formatCommitMessage'

describe('formatCommitMessage', () => {
  it('should return string input unchanged', () => {
    const input = 'fix: simple commit message\n\nThis is a regular commit message'
    const result = formatCommitMessage(input)
    expect(result).toBe(input)
  })

  it('should format JSON object with title and body', () => {
    const input = { title: 'fix: bug fix', body: 'Fixed an important bug' }
    const result = formatCommitMessage(input)
    expect(result).toBe('fix: bug fix\n\nFixed an important bug')
  })

  it('should format JSON object with append text', () => {
    const input = { title: 'feat: new feature', body: 'Added new functionality' }
    const result = formatCommitMessage(input, { append: 'Breaking change' })
    expect(result).toBe('feat: new feature\n\nAdded new functionality\n\nBreaking change')
  })

  it('should format JSON object with ticket footer', () => {
    const input = { title: 'fix: bug fix', body: 'Fixed bug' }
    const result = formatCommitMessage(input, { 
      ticketId: 'JIRA-123', 
      appendTicket: true 
    })
    expect(result).toBe('fix: bug fix\n\nFixed bug\n\nPart of **JIRA-123**')
  })

  it('should parse stringified JSON object', () => {
    const input = JSON.stringify({ title: 'chore: update docs', body: 'Updated documentation' })
    const result = formatCommitMessage(input)
    expect(result).toBe('chore: update docs\n\nUpdated documentation')
  })

  it('should parse stringified JSON object with options', () => {
    const input = JSON.stringify({ title: 'feat: add feature', body: 'New feature added' })
    const result = formatCommitMessage(input, { 
      append: 'Co-authored-by: John Doe',
      ticketId: 'TICKET-456',
      appendTicket: true
    })
    expect(result).toBe('feat: add feature\n\nNew feature added\n\nCo-authored-by: John Doe\n\nPart of **TICKET-456**')
  })

  it('should handle malformed JSON strings', () => {
    const input = 'not valid json'
    const result = formatCommitMessage(input)
    expect(result).toBe('not valid json')
  })

  it('should handle JSON without title/body properties', () => {
    const input = JSON.stringify({ message: 'wrong format' })
    const result = formatCommitMessage(input)
    expect(result).toBe('{"message":"wrong format"}')
  })

  it('should handle undefined/null inputs', () => {
    expect(formatCommitMessage(null)).toBe('null')
    expect(formatCommitMessage(undefined)).toBe('undefined')
  })

  it('should skip ticket footer when appendTicket is false', () => {
    const input = { title: 'fix: bug', body: 'Fixed bug' }
    const result = formatCommitMessage(input, { 
      ticketId: 'TICKET-789',
      appendTicket: false 
    })
    expect(result).toBe('fix: bug\n\nFixed bug')
  })

  it('should skip ticket footer when ticketId is not provided', () => {
    const input = { title: 'fix: bug', body: 'Fixed bug' }
    const result = formatCommitMessage(input, { appendTicket: true })
    expect(result).toBe('fix: bug\n\nFixed bug')
  })
})