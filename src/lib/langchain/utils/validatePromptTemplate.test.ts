import { validatePromptTemplate } from './validatePromptTemplate'

describe('validatePromptTemplate', () => {
  describe('Empty template validation', () => {
    it('should throw error for empty string', () => {
      expect(() => validatePromptTemplate('', ['variable'])).toThrow('Prompt template cannot be empty')
    })

    it('should throw error for whitespace-only string', () => {
      expect(() => validatePromptTemplate('   \n\t  ', ['variable'])).toThrow('Prompt template cannot be empty')
    })
  })

  describe('No variables required', () => {
    it('should pass when no variables are required', () => {
      expect(() => validatePromptTemplate('Hello world', [])).not.toThrow()
    })

    it('should pass when inputVariables is undefined', () => {
      expect(() => validatePromptTemplate('Hello world', undefined as unknown as string[])).not.toThrow()
    })
  })

  describe('Single variable validation', () => {
    it('should pass when required variable is present', () => {
      expect(() => validatePromptTemplate('Hello {name}!', ['name'])).not.toThrow()
    })

    it('should throw when required variable is missing', () => {
      expect(() => validatePromptTemplate('Hello world!', ['name'])).toThrow(
        'Prompt template is missing required variables: {name}. Found variables: none'
      )
    })

    it('should not recognize variables with whitespace inside braces', () => {
      expect(() => validatePromptTemplate('Hello { name }!', ['name'])).toThrow(
        'Prompt template is missing required variables: {name}. Found variables: none'
      )
    })
  })

  describe('Multiple variables validation', () => {
    it('should pass when all required variables are present', () => {
      expect(() => validatePromptTemplate(
        'Hello {name}, you are {age} years old and live in {city}.',
        ['name', 'age', 'city']
      )).not.toThrow()
    })

    it('should throw when some variables are missing', () => {
      expect(() => validatePromptTemplate(
        'Hello {name}, you are {age} years old.',
        ['name', 'age', 'city']
      )).toThrow(
        'Prompt template is missing required variables: {city}. Found variables: {name}, {age}'
      )
    })

    it('should throw when all variables are missing', () => {
      expect(() => validatePromptTemplate(
        'Hello world!',
        ['name', 'age', 'city']
      )).toThrow(
        'Prompt template is missing required variables: {name}, {age}, {city}. Found variables: none'
      )
    })
  })

  describe('Variable format detection', () => {
    it('should only detect properly formatted variables', () => {
      const template = 'Hello {name}, your score is score} and {incomplete'
      expect(() => validatePromptTemplate(template, ['name', 'score', 'incomplete'])).toThrow(
        'Prompt template is missing required variables: {score}, {incomplete}. Found variables: {name}'
      )
    })

    it('should handle duplicate variables in template', () => {
      expect(() => validatePromptTemplate(
        'Hello {name}, {name} is a great name!',
        ['name']
      )).not.toThrow()
    })

    it('should handle nested braces correctly', () => {
      expect(() => validatePromptTemplate(
        'Hello {name}, your JSON is {"key": "value"}',
        ['name']
      )).not.toThrow()
    })
  })

  describe('Unused variables warning', () => {
    let consoleSpy: jest.SpyInstance

    beforeEach(() => {
      consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    })

    afterEach(() => {
      consoleSpy.mockRestore()
    })

    it('should warn about unused variables in template', () => {
      validatePromptTemplate('Hello {name} and {unused}!', ['name'])
      
      expect(consoleSpy).toHaveBeenCalledWith(
        'Prompt template contains undefined variables: {unused}'
      )
    })

    it('should warn about multiple unused variables', () => {
      validatePromptTemplate('Hello {name}, {extra1} and {extra2}!', ['name'])
      
      expect(consoleSpy).toHaveBeenCalledWith(
        'Prompt template contains undefined variables: {extra1}, {extra2}'
      )
    })

    it('should not warn when all variables are defined', () => {
      validatePromptTemplate('Hello {name}!', ['name'])
      
      expect(consoleSpy).not.toHaveBeenCalled()
    })
  })

  describe('Edge cases', () => {
    it('should not recognize empty braces as variables', () => {
      expect(() => validatePromptTemplate('Hello {}!', [''])).toThrow(
        'Prompt template is missing required variables: {}. Found variables: none'
      )
    })

    it('should handle special characters in variable names', () => {
      expect(() => validatePromptTemplate(
        'Hello {user_name} and {user-id}!',
        ['user_name', 'user-id']
      )).not.toThrow()
    })

    it('should handle numbers in variable names', () => {
      expect(() => validatePromptTemplate(
        'Item {item1} and {item2}',
        ['item1', 'item2']
      )).not.toThrow()
    })

    it('should handle very long templates', () => {
      const longTemplate = 'A'.repeat(10000) + ' {variable} ' + 'B'.repeat(10000)
      expect(() => validatePromptTemplate(longTemplate, ['variable'])).not.toThrow()
    })
  })

  describe('Real-world examples', () => {
    it('should validate commit message template', () => {
      const template = `Generate a commit message for the following changes:

Changes: {summary}
Format: {format_instructions}
Additional context: {additional_context}

Please provide a concise commit message.`

      expect(() => validatePromptTemplate(template, [
        'summary',
        'format_instructions', 
        'additional_context'
      ])).not.toThrow()
    })

    it('should validate review template', () => {
      const template = `Review the following code changes:

File: {filePath}
Changes: {changes}
Context: {context}

Provide feedback on:
1. Code quality
2. Potential issues
3. Suggestions for improvement`

      expect(() => validatePromptTemplate(template, [
        'filePath',
        'changes',
        'context'
      ])).not.toThrow()
    })
  })
})