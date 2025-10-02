import { ConventionalCommitMessageResponseSchema, CommitMessageResponseSchema } from './config'
import { CONVENTIONAL_COMMIT_PROMPT, COMMIT_PROMPT } from './prompt'

describe('Conventional Commits Configuration', () => {
  describe('ConventionalCommitMessageResponseSchema', () => {
    it('should validate valid conventional commit format', () => {
      const validCommit = {
        title: 'feat: add new authentication system',
        body: 'Implement JWT-based authentication with login and logout functionality.'
      }
      
      const result = ConventionalCommitMessageResponseSchema.safeParse(validCommit)
      expect(result.success).toBe(true)
    })

    it('should validate conventional commit with scope', () => {
      const validCommit = {
        title: 'fix(auth): resolve login timeout issue',
        body: 'Increase timeout duration and add retry logic for better reliability.'
      }
      
      const result = ConventionalCommitMessageResponseSchema.safeParse(validCommit)
      expect(result.success).toBe(true)
    })

    it('should reject title longer than 50 characters', () => {
      const invalidCommit = {
        title: 'feat: add a very long feature description that exceeds the fifty character limit',
        body: 'This should fail validation.'
      }
      
      const result = ConventionalCommitMessageResponseSchema.safeParse(invalidCommit)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('50 characters or less')
      }
    })

    it('should reject non-conventional commit format', () => {
      const invalidCommit = {
        title: 'Add new feature without proper format',
        body: 'This does not follow conventional commits format.'
      }
      
      const result = ConventionalCommitMessageResponseSchema.safeParse(invalidCommit)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('Conventional Commits format')
      }
    })

    it('should accept all valid conventional commit types', () => {
      const validTypes = [
        'feat', 'fix', 'docs', 'style', 'refactor', 
        'perf', 'test', 'build', 'ci', 'chore', 'revert'
      ]
      
      validTypes.forEach(type => {
        const commit = {
          title: `${type}: test commit`,
          body: 'Test body content.'
        }
        
        const result = ConventionalCommitMessageResponseSchema.safeParse(commit)
        expect(result.success).toBe(true)
      })
    })

    it('should accept breaking change format', () => {
      const breakingChange = {
        title: 'feat!: add breaking API changes',
        body: 'BREAKING CHANGE: API endpoints have been restructured.'
      }
      
      const result = ConventionalCommitMessageResponseSchema.safeParse(breakingChange)
      expect(result.success).toBe(true)
    })

    it('should accept scope with breaking change', () => {
      const breakingChange = {
        title: 'feat(api)!: restructure authentication endpoints',
        body: 'BREAKING CHANGE: All auth endpoints now require v2 prefix.'
      }
      
      const result = ConventionalCommitMessageResponseSchema.safeParse(breakingChange)
      expect(result.success).toBe(true)
    })
  })

  describe('Regular CommitMessageResponseSchema', () => {
    it('should accept any title format', () => {
      const commit = {
        title: 'Add new feature without conventional format',
        body: 'This should be accepted by the regular schema.'
      }
      
      const result = CommitMessageResponseSchema.safeParse(commit)
      expect(result.success).toBe(true)
    })

    it('should accept empty body', () => {
      const commit = {
        title: 'Simple commit',
        body: ''
      }
      
      const result = CommitMessageResponseSchema.safeParse(commit)
      expect(result.success).toBe(true)
    })
  })

  describe('Prompt Templates', () => {
    it('should have all required input variables for conventional prompt', () => {
      const expectedVariables = [
        'summary',
        'additional_context',
        'commit_history',
        'format_instructions',
        'branch_name_context',
        'commitlint_rules_context'
      ]
      
      expectedVariables.forEach(variable => {
        expect(CONVENTIONAL_COMMIT_PROMPT.inputVariables).toContain(variable)
      })
    })

    it('should have all required input variables for regular prompt', () => {
      const expectedVariables = [
        'summary',
        'format_instructions',
        'additional_context',
        'commit_history',
        'branch_name_context',
        'commitlint_rules_context'
      ]
      
      expectedVariables.forEach(variable => {
        expect(COMMIT_PROMPT.inputVariables).toContain(variable)
      })
    })

    it('should contain conventional commits guidance in template', () => {
      expect(CONVENTIONAL_COMMIT_PROMPT.template).toContain('Conventional Commits')
      expect(CONVENTIONAL_COMMIT_PROMPT.template).toContain('feat:')
      expect(CONVENTIONAL_COMMIT_PROMPT.template).toContain('fix:')
      expect(CONVENTIONAL_COMMIT_PROMPT.template).toContain('type')
      expect(CONVENTIONAL_COMMIT_PROMPT.template).toContain('scope')
    })

    it('should contain JSON formatting instructions', () => {
      expect(CONVENTIONAL_COMMIT_PROMPT.template).toContain('JSON')
      expect(COMMIT_PROMPT.template).toContain('format_instructions')
    })
  })

  describe('Schema Validation Edge Cases', () => {
    it('should handle minimal valid conventional commit', () => {
      const minimalCommit = {
        title: 'fix: bug',
        body: 'Fixed.'
      }
      
      const result = ConventionalCommitMessageResponseSchema.safeParse(minimalCommit)
      expect(result.success).toBe(true)
    })

    it('should handle maximum length conventional commit', () => {
      const maxLengthCommit = {
        title: 'feat(scope): add feature that is exactly fifty', // Exactly 50 chars
        body: 'This is a detailed explanation of the changes made.'
      }
      
      const result = ConventionalCommitMessageResponseSchema.safeParse(maxLengthCommit)
      expect(result.success).toBe(true)
    })

    it('should reject invalid type', () => {
      const invalidType = {
        title: 'invalid: not a valid conventional commit type',
        body: 'This should fail.'
      }
      
      const result = ConventionalCommitMessageResponseSchema.safeParse(invalidType)
      expect(result.success).toBe(false)
    })

    it('should reject missing colon', () => {
      const missingColon = {
        title: 'feat add feature without colon',
        body: 'This should fail.'
      }
      
      const result = ConventionalCommitMessageResponseSchema.safeParse(missingColon)
      expect(result.success).toBe(false)
    })

    it('should handle complex scopes', () => {
      const complexScope = {
        title: 'feat(api-auth-v2): add new authentication',
        body: 'Added comprehensive authentication system.'
      }
      
      const result = ConventionalCommitMessageResponseSchema.safeParse(complexScope)
      expect(result.success).toBe(true)
    })
  })
})