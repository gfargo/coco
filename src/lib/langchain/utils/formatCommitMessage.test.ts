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

  // New test cases for markdown code block handling
  describe('markdown code block handling', () => {
    it('should parse JSON wrapped in markdown code blocks with json language', () => {
      const input = '```json\n{"title":"feat: new feature","body":"Added new functionality"}\n```'
      const result = formatCommitMessage(input)
      expect(result).toBe('feat: new feature\n\nAdded new functionality')
    })

    it('should parse JSON wrapped in markdown code blocks without language specifier', () => {
      const input = '```\n{"title":"fix: bug fix","body":"Fixed critical bug"}\n```'
      const result = formatCommitMessage(input)
      expect(result).toBe('fix: bug fix\n\nFixed critical bug')
    })

    it('should parse JSON wrapped in markdown code blocks with extra whitespace', () => {
      const input = '```json\n  \n{"title":"chore: update deps","body":"Updated dependencies"}  \n  \n```'
      const result = formatCommitMessage(input)
      expect(result).toBe('chore: update deps\n\nUpdated dependencies')
    })

    it('should parse JSON in markdown code blocks with options', () => {
      const input = '```json\n{"title":"feat: add feature","body":"New feature added"}\n```'
      const result = formatCommitMessage(input, { 
        append: 'Breaking change',
        ticketId: 'PROJ-123',
        appendTicket: true
      })
      expect(result).toBe('feat: add feature\n\nNew feature added\n\nBreaking change\n\nPart of **PROJ-123**')
    })

    it('should fallback to original string if markdown contains invalid JSON', () => {
      const input = '```json\n{"title":"incomplete json"}\n```'
      const result = formatCommitMessage(input)
      expect(result).toBe('```json\n{"title":"incomplete json"}\n```')
    })

    it('should fallback to original string if markdown contains non-JSON', () => {
      const input = '```\nThis is just regular text\n```'
      const result = formatCommitMessage(input)
      expect(result).toBe('```\nThis is just regular text\n```')
    })
  })

  // Enhanced robustness tests
  describe('enhanced robustness', () => {
    it('should handle objects with non-string title/body properties', () => {
      const input = { title: 123, body: true }
      const result = formatCommitMessage(input)
      expect(result).toBe('[object Object]')
    })

    it('should handle objects missing title property', () => {
      const input = { body: 'Has body but no title' }
      const result = formatCommitMessage(input)
      expect(result).toBe('[object Object]')
    })

    it('should handle objects missing body property', () => {
      const input = { title: 'Has title but no body' }
      const result = formatCommitMessage(input)
      expect(result).toBe('[object Object]')
    })

    it('should handle stringified JSON with non-string title/body', () => {
      const input = JSON.stringify({ title: 123, body: null })
      const result = formatCommitMessage(input)
      expect(result).toBe('{"title":123,"body":null}')
    })

    it('should handle multiline JSON in code blocks', () => {
      const input = `\`\`\`json
{
  "title": "feat: multiline json",
  "body": "This JSON spans\\nmultiple lines\\nfor better readability"
}
\`\`\``
      const result = formatCommitMessage(input)
      expect(result).toBe('feat: multiline json\n\nThis JSON spans\nmultiple lines\nfor better readability')
    })

    it('should handle empty options object', () => {
      const input = { title: 'test', body: 'message' }
      const result = formatCommitMessage(input, {})
      expect(result).toBe('test\n\nmessage')
    })

    it('should handle inline code blocks', () => {
      const input = '`{"title":"feat: inline code","body":"JSON in inline code block"}`'
      const result = formatCommitMessage(input)
      expect(result).toBe('feat: inline code\n\nJSON in inline code block')
    })

    it('should handle raw JSON without code blocks', () => {
      const input = '   {"title":"fix: raw json","body":"No markdown wrapping"}   '
      const result = formatCommitMessage(input)
      expect(result).toBe('fix: raw json\n\nNo markdown wrapping')
    })

    it('should validate title and body are non-empty strings', () => {
      const input = '{"title":"","body":"Empty title"}'
      const result = formatCommitMessage(input)
      expect(result).toBe('{"title":"","body":"Empty title"}')
    })

    it('should validate title and body are non-empty strings (empty body)', () => {
      const input = '{"title":"Has title","body":""}'
      const result = formatCommitMessage(input)
      expect(result).toBe('{"title":"Has title","body":""}')
    })

    it('should early return for strings without JSON indicators', () => {
      const input = 'This is just plain text with no JSON or braces'
      const result = formatCommitMessage(input)
      expect(result).toBe('This is just plain text with no JSON or braces')
    })

    it('should handle complex nested JSON but only extract title/body', () => {
      const input = '```json\n{"title":"feat: complex","body":"Has nested data","metadata":{"author":"test","date":"2023"}}\n```'
      const result = formatCommitMessage(input)
      expect(result).toBe('feat: complex\n\nHas nested data')
    })

    it('should prioritize first matching pattern', () => {
      const input = '```json\n{"title":"first","body":"First match"}\n``` and `{"title":"second","body":"Second"}`'
      const result = formatCommitMessage(input)
      expect(result).toBe('first\n\nFirst match')
    })

    it('should repair malformed JSON with unquoted values', () => {
      const input = '{"title": chore(.gitignore): update ignore rules, "body": "Updated gitignore file"}'
      const result = formatCommitMessage(input)
      expect(result).toBe('chore(.gitignore): update ignore rules\n\nUpdated gitignore file')
    })

    it('should repair the exact issue example', () => {
      const input = '{"title": chore(.gitignore): update ignore rules and add config file,"body": "Modify .gitignore to include next-env.d.ts and .coco.config.json for better project hygiene and consistency. This change helps prevent unnecessary files from being committed and improves environment setup clarity."}'
      const result = formatCommitMessage(input)
      expect(result).toBe('chore(.gitignore): update ignore rules and add config file\n\nModify .gitignore to include next-env.d.ts and .coco.config.json for better project hygiene and consistency. This change helps prevent unnecessary files from being committed and improves environment setup clarity.')
    })

    it('should handle valid conventional commit JSON correctly', () => {
      const input = '{"title": "build: add comprehensive analytics tracking for registry and components","body": "Implement analytics events for registry access, component downloads, errors, performance, and user interactions across API routes and UI components to enable detailed insights and monitoring."}'
      const result = formatCommitMessage(input)
      expect(result).toBe('build: add comprehensive analytics tracking for registry and components\n\nImplement analytics events for registry access, component downloads, errors, performance, and user interactions across API routes and UI components to enable detailed insights and monitoring.')
    })
  })
})