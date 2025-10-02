import { repairJson } from './repairJson'

describe('repairJson', () => {
  it('should return valid JSON unchanged', () => {
    const validJson = '{"title": "feat: add feature", "body": "Added new functionality"}'
    expect(repairJson(validJson)).toBe(validJson)
  })

  it('should fix unquoted title value', () => {
    const malformedJson = '{"title": chore(.gitignore): update ignore rules, "body": "Updated gitignore file"}'
    const expected = '{"title": "chore(.gitignore): update ignore rules", "body": "Updated gitignore file"}'
    expect(repairJson(malformedJson)).toBe(expected)
  })

  it('should fix unquoted body value', () => {
    const malformedJson = '{"title": "feat: add feature", "body": This is an unquoted body}'
    const expected = '{"title": "feat: add feature", "body": "This is an unquoted body"}'
    expect(repairJson(malformedJson)).toBe(expected)
  })

  it('should fix both unquoted title and body', () => {
    const malformedJson = '{"title": fix(auth): resolve login issue, "body": Fixed authentication bug}'
    const expected = '{"title": "fix(auth): resolve login issue", "body": "Fixed authentication bug"}'
    expect(repairJson(malformedJson)).toBe(expected)
  })

  it('should handle markdown code blocks', () => {
    const wrappedJson = '```json\n{"title": chore: update deps, "body": "Updated dependencies"}\n```'
    const expected = '{"title": "chore: update deps", "body": "Updated dependencies"}'
    expect(repairJson(wrappedJson)).toBe(expected)
  })

  it('should handle inline code blocks', () => {
    const wrappedJson = '`{"title": feat: new feature, "body": "Added feature"}`'
    const expected = '{"title": "feat: new feature", "body": "Added feature"}'
    expect(repairJson(wrappedJson)).toBe(expected)
  })

  it('should remove trailing commas', () => {
    const malformedJson = '{"title": "feat: add feature", "body": "Added functionality",}'
    const expected = '{"title": "feat: add feature", "body": "Added functionality"}'
    expect(repairJson(malformedJson)).toBe(expected)
  })

  it('should handle complex unquoted values with special characters', () => {
    const malformedJson = '{"title": chore(.gitignore): update ignore rules and add config file, "body": "Modified gitignore"}'
    const expected = '{"title": "chore(.gitignore): update ignore rules and add config file", "body": "Modified gitignore"}'
    expect(repairJson(malformedJson)).toBe(expected)
  })

  it('should not modify already quoted values', () => {
    const validJson = '{"title": "feat: add feature", "body": "Already quoted properly"}'
    expect(repairJson(validJson)).toBe(validJson)
  })

  it('should return non-JSON strings unchanged', () => {
    const nonJson = 'This is not JSON at all'
    expect(repairJson(nonJson)).toBe(nonJson)
  })

  it('should handle empty or malformed objects gracefully', () => {
    const emptyObj = '{}'
    expect(repairJson(emptyObj)).toBe(emptyObj)
    
    const malformed = '{'
    expect(repairJson(malformed)).toBe(malformed)
  })

  it('should handle multiline unquoted values', () => {
    const malformedJson = `{"title": feat: add multiline support, "body": "This is a proper body"}`
    const expected = `{"title": "feat: add multiline support", "body": "This is a proper body"}`
    expect(repairJson(malformedJson)).toBe(expected)
  })

  it('should preserve numeric and boolean values', () => {
    const jsonWithNumbers = '{"title": "feat: add feature", "body": "Added feature", "count": 42, "enabled": true}'
    expect(repairJson(jsonWithNumbers)).toBe(jsonWithNumbers)
  })

  it('should handle the exact example from the issue', () => {
    const issueExample = '{"title": chore(.gitignore): update ignore rules and add config file,"body": "Modify .gitignore to include next-env.d.ts and .coco.config.json for better project hygiene and consistency. This change helps prevent unnecessary files from being committed and improves environment setup clarity."}'
    const expected = '{"title": "chore(.gitignore): update ignore rules and add config file","body": "Modify .gitignore to include next-env.d.ts and .coco.config.json for better project hygiene and consistency. This change helps prevent unnecessary files from being committed and improves environment setup clarity."}'
    expect(repairJson(issueExample)).toBe(expected)
  })

  it('should handle valid conventional commit JSON unchanged', () => {
    const validConventionalCommit = '{"title": "build: add comprehensive analytics tracking for registry and components","body": "Implement analytics events for registry access, component downloads, errors, performance, and user interactions across API routes and UI components to enable detailed insights and monitoring."}'
    expect(repairJson(validConventionalCommit)).toBe(validConventionalCommit)
  })
})