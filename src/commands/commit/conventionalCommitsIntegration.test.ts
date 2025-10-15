import { formatCommitMessage } from '../../lib/langchain/utils/formatCommitMessage'
import { repairJson } from '../../lib/utils/repairJson'

describe('Conventional Commits Integration', () => {
  describe('End-to-End JSON Processing', () => {
    it('should handle complete conventional commit flow with valid JSON', () => {
      const aiResponse = '{"title": "feat(auth): add OAuth2 integration", "body": "Implement OAuth2 authentication flow with Google and GitHub providers. Includes token refresh and user profile management."}'
      
      const result = formatCommitMessage(aiResponse, {
        append: 'Closes #123',
        ticketId: 'PROJ-456',
        appendTicket: true
      })
      
      const expected = 'feat(auth): add OAuth2 integration\n\nImplement OAuth2 authentication flow with Google and GitHub providers. Includes token refresh and user profile management.\n\nCloses #123\n\nPart of **PROJ-456**'
      expect(result).toBe(expected)
    })

    it('should handle malformed JSON from AI and repair it', () => {
      const malformedResponse = '{"title": feat(ui): improve responsive design, "body": "Update CSS grid layouts and media queries for better mobile experience. Includes touch-friendly button sizes and improved navigation."}'
      
      const result = formatCommitMessage(malformedResponse)
      
      const expected = 'feat(ui): improve responsive design\n\nUpdate CSS grid layouts and media queries for better mobile experience. Includes touch-friendly button sizes and improved navigation.'
      expect(result).toBe(expected)
    })

    it('should handle conventional commits in markdown code blocks', () => {
      const markdownResponse = '```json\n{"title": "fix(api): resolve rate limiting issues", "body": "Implement exponential backoff and retry logic for API calls. Improves reliability under high load conditions."}\n```'
      
      const result = formatCommitMessage(markdownResponse)
      
      const expected = 'fix(api): resolve rate limiting issues\n\nImplement exponential backoff and retry logic for API calls. Improves reliability under high load conditions.'
      expect(result).toBe(expected)
    })

    it('should handle breaking changes format', () => {
      const breakingChangeResponse = '{"title": "feat!: restructure API endpoints", "body": "BREAKING CHANGE: All API endpoints now use v2 prefix. Update client applications to use /api/v2/ instead of /api/."}'
      
      const result = formatCommitMessage(breakingChangeResponse)
      
      const expected = 'feat!: restructure API endpoints\n\nBREAKING CHANGE: All API endpoints now use v2 prefix. Update client applications to use /api/v2/ instead of /api/.'
      expect(result).toBe(expected)
    })

    it('should handle scoped breaking changes', () => {
      const scopedBreakingChange = '{"title": "refactor(database)!: change user schema", "body": "BREAKING CHANGE: User table schema updated. Migration required for existing databases."}'
      
      const result = formatCommitMessage(scopedBreakingChange)
      
      const expected = 'refactor(database)!: change user schema\n\nBREAKING CHANGE: User table schema updated. Migration required for existing databases.'
      expect(result).toBe(expected)
    })
  })

  describe('Real-world Scenarios', () => {
    it('should handle complex conventional commit with all features', () => {
      const complexResponse = '{"title": "feat(auth): add multi-factor authentication", "body": "Implement TOTP-based 2FA with backup codes. Includes user enrollment flow, recovery options, and admin management interface. Supports Google Authenticator and Authy."}'
      
      const result = formatCommitMessage(complexResponse, {
        append: 'Co-authored-by: Jane Doe <jane@example.com>',
        ticketId: 'SEC-789',
        appendTicket: true
      })
      
      const expected = 'feat(auth): add multi-factor authentication\n\nImplement TOTP-based 2FA with backup codes. Includes user enrollment flow, recovery options, and admin management interface. Supports Google Authenticator and Authy.\n\nCo-authored-by: Jane Doe <jane@example.com>\n\nPart of **SEC-789**'
      expect(result).toBe(expected)
    })

    it('should handle malformed JSON with special characters', () => {
      const specialCharsResponse = '{"title": chore(deps): update @types/node to v18.15.0, "body": "Update TypeScript definitions for Node.js. Includes new APIs and improved type safety."}'
      
      const result = formatCommitMessage(specialCharsResponse)
      
      const expected = 'chore(deps): update @types/node to v18.15.0\n\nUpdate TypeScript definitions for Node.js. Includes new APIs and improved type safety.'
      expect(result).toBe(expected)
    })

    it('should handle revert commits', () => {
      const revertResponse = '{"title": "revert: remove experimental feature", "body": "This reverts commit abc123def456. The feature caused performance issues in production."}'
      
      const result = formatCommitMessage(revertResponse)
      
      const expected = 'revert: remove experimental feature\n\nThis reverts commit abc123def456. The feature caused performance issues in production.'
      expect(result).toBe(expected)
    })

    it('should handle docs commits', () => {
      const docsResponse = '{"title": "docs(api): update authentication examples", "body": "Add comprehensive examples for OAuth2 flow. Includes code samples in JavaScript, Python, and cURL."}'
      
      const result = formatCommitMessage(docsResponse)
      
      const expected = 'docs(api): update authentication examples\n\nAdd comprehensive examples for OAuth2 flow. Includes code samples in JavaScript, Python, and cURL.'
      expect(result).toBe(expected)
    })

    it('should handle test commits', () => {
      const testResponse = '{"title": "test(auth): add integration tests for OAuth flow", "body": "Add comprehensive test coverage for OAuth2 authentication. Includes happy path, error cases, and edge conditions."}'
      
      const result = formatCommitMessage(testResponse)
      
      const expected = 'test(auth): add integration tests for OAuth flow\n\nAdd comprehensive test coverage for OAuth2 authentication. Includes happy path, error cases, and edge conditions.'
      expect(result).toBe(expected)
    })

    it('should handle build/ci commits', () => {
      const buildResponse = '{"title": "ci: add automated security scanning", "body": "Integrate SAST and dependency scanning into CI pipeline. Includes vulnerability reporting and PR blocking for high-severity issues."}'
      
      const result = formatCommitMessage(buildResponse)
      
      const expected = 'ci: add automated security scanning\n\nIntegrate SAST and dependency scanning into CI pipeline. Includes vulnerability reporting and PR blocking for high-severity issues.'
      expect(result).toBe(expected)
    })
  })

  describe('Error Recovery', () => {
    it('should gracefully handle completely invalid JSON', () => {
      const invalidJson = 'This is not JSON at all, just plain text'
      
      const result = formatCommitMessage(invalidJson)
      
      expect(result).toBe(invalidJson)
    })

    it('should handle JSON with missing required fields', () => {
      const incompleteJson = '{"title": "feat: add feature"}'
      
      const result = formatCommitMessage(incompleteJson)
      
      expect(result).toBe(incompleteJson)
    })

    it('should handle empty JSON object', () => {
      const emptyJson = '{}'
      
      const result = formatCommitMessage(emptyJson)
      
      expect(result).toBe(emptyJson)
    })

    it('should handle JSON with null values', () => {
      const nullJson = '{"title": null, "body": null}'
      
      const result = formatCommitMessage(nullJson)
      
      expect(result).toBe(nullJson)
    })
  })

  describe('JSON Repair Specific Cases', () => {
    it('should handle JSON with excessive whitespace', () => {
      const whitespaceHeavyJson = '{\n\n  "title": "feat(components): add SVG upload feature",\n  "body": "Introduce functionality to upload SVG files and import their path data."\n}'

      const result = formatCommitMessage(whitespaceHeavyJson)

      const expected = 'feat(components): add SVG upload feature\n\nIntroduce functionality to upload SVG files and import their path data.'
      expect(result).toBe(expected)
    })

    it('should handle JSON with leading whitespace', () => {
      const leadingWhitespace = '\n\n{\n  "title": "fix(auth): resolve timeout issue",\n  "body": "Increase timeout duration for better reliability."\n}'

      const result = formatCommitMessage(leadingWhitespace)

      const expected = 'fix(auth): resolve timeout issue\n\nIncrease timeout duration for better reliability.'
      expect(result).toBe(expected)
    })

    it('should repair multiple unquoted values', () => {
      const multipleUnquoted = '{"title": feat(api): add rate limiting, "body": Implement token bucket algorithm for API rate limiting}'

      const repaired = repairJson(multipleUnquoted)
      const result = formatCommitMessage(repaired)

      const expected = 'feat(api): add rate limiting\n\nImplement token bucket algorithm for API rate limiting'
      expect(result).toBe(expected)
    })

    it('should handle trailing commas in JSON', () => {
      const trailingComma = '{"title": "perf: optimize database queries", "body": "Add indexes and query optimization for better performance.",}'
      
      const repaired = repairJson(trailingComma)
      const result = formatCommitMessage(repaired)
      
      const expected = 'perf: optimize database queries\n\nAdd indexes and query optimization for better performance.'
      expect(result).toBe(expected)
    })

    it('should handle mixed quoted and unquoted values', () => {
      const mixedQuoting = '{"title": "style: format code with prettier", "body": Update code formatting across all TypeScript files}'

      const repaired = repairJson(mixedQuoting)
      const result = formatCommitMessage(repaired)

      const expected = 'style: format code with prettier\n\nUpdate code formatting across all TypeScript files'
      expect(result).toBe(expected)
    })
  })

  describe('Advanced Edge Cases', () => {
    it('should handle text before JSON', () => {
      const textBeforeJson = 'Here is your commit message:\n{"title": "feat(api): add endpoint", "body": "Add new REST endpoint for user management."}'

      const result = formatCommitMessage(textBeforeJson)

      // Should extract the JSON and ignore the text before it
      const expected = 'feat(api): add endpoint\n\nAdd new REST endpoint for user management.'
      expect(result).toBe(expected)
    })

    it('should handle text after JSON', () => {
      const textAfterJson = '{"title": "fix(ui): resolve button alignment", "body": "Fix button positioning in header."}\n\nDoes this commit message work for you?'

      const result = formatCommitMessage(textAfterJson)

      // Should extract the JSON and ignore the text after it
      const expected = 'fix(ui): resolve button alignment\n\nFix button positioning in header.'
      expect(result).toBe(expected)
    })

    it('should handle multiple JSON objects by using the first one', () => {
      const multipleObjects = '{"title": "feat: add feature A", "body": "First option"} or {"title": "feat: add feature B", "body": "Second option"}'

      const result = formatCommitMessage(multipleObjects)

      // Should use the first valid JSON object
      const expected = 'feat: add feature A\n\nFirst option'
      expect(result).toBe(expected)
    })

    it('should handle unicode and emojis in commit messages', () => {
      const unicodeJson = '{"title": "feat: add 🎉 celebration animation", "body": "Introduce confetti animation for successful actions. Improves user experience with visual feedback."}'

      const result = formatCommitMessage(unicodeJson)

      const expected = 'feat: add 🎉 celebration animation\n\nIntroduce confetti animation for successful actions. Improves user experience with visual feedback.'
      expect(result).toBe(expected)
    })

    it('should handle very long commit body', () => {
      const longBody = 'This is a very long commit body that contains a lot of information about the changes made. '.repeat(50)
      const longJson = `{"title": "refactor(core): restructure architecture", "body": "${longBody}"}`

      const result = formatCommitMessage(longJson)

      expect(result).toContain('refactor(core): restructure architecture')
      expect(result).toContain(longBody)
      expect(result.length).toBeGreaterThan(2000)
    })

    it('should handle JSON with newlines in body text', () => {
      const jsonWithNewlines = '{"title": "docs: update README", "body": "Update documentation:\\n- Add installation guide\\n- Add usage examples\\n- Fix typos"}'

      const result = formatCommitMessage(jsonWithNewlines)

      const expected = 'docs: update README\n\nUpdate documentation:\n- Add installation guide\n- Add usage examples\n- Fix typos'
      expect(result).toBe(expected)
    })

    it('should handle JSON with escaped quotes in body', () => {
      const jsonWithEscapedQuotes = '{"title": "fix(parser): handle quoted strings", "body": "Fix parsing of strings with \\"escaped quotes\\" in the content."}'

      const result = formatCommitMessage(jsonWithEscapedQuotes)

      const expected = 'fix(parser): handle quoted strings\n\nFix parsing of strings with "escaped quotes" in the content.'
      expect(result).toBe(expected)
    })

    it('should handle compact JSON on single line', () => {
      const compactJson = '{"title":"feat(auth):add2FA","body":"Implement two-factor authentication with TOTP support."}'

      const result = formatCommitMessage(compactJson)

      const expected = 'feat(auth):add2FA\n\nImplement two-factor authentication with TOTP support.'
      expect(result).toBe(expected)
    })

    it('should handle JSON with tab characters', () => {
      const jsonWithTabs = '{\t"title":\t"chore: cleanup code",\t"body":\t"Remove unused imports and format code."\t}'

      const result = formatCommitMessage(jsonWithTabs)

      const expected = 'chore: cleanup code\n\nRemove unused imports and format code.'
      expect(result).toBe(expected)
    })

    it('should handle JSON response from verbose AI', () => {
      const verboseResponse = `Based on your changes, I suggest this commit message:

\`\`\`json
{
  "title": "feat(components): add Button component",
  "body": "Create reusable Button component with variants (primary, secondary, danger). Includes hover states and disabled state."
}
\`\`\`

This follows the Conventional Commits format and describes your changes clearly.`

      const result = formatCommitMessage(verboseResponse)

      const expected = 'feat(components): add Button component\n\nCreate reusable Button component with variants (primary, secondary, danger). Includes hover states and disabled state.'
      expect(result).toBe(expected)
    })
  })
})