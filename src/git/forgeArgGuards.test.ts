import { rejectFlagLike, rejectUnsafeLabel, rejectUnsafeUsername } from './forgeArgGuards'

describe('rejectFlagLike', () => {
  it('rejects values starting with a dash', () => {
    expect(rejectFlagLike('--delete', 'Branch name')).toBe("Branch name cannot start with '-'.")
  })

  it('allows other values', () => {
    expect(rejectFlagLike('main', 'Branch name')).toBeUndefined()
  })
})

describe('rejectUnsafeUsername', () => {
  it('rejects values starting with a dash', () => {
    expect(rejectUnsafeUsername('-rf')).toBeDefined()
  })

  it('rejects commas and whitespace', () => {
    expect(rejectUnsafeUsername('bob,carol')).toBeDefined()
    expect(rejectUnsafeUsername('bob carol')).toBeDefined()
  })

  it('allows a plain username', () => {
    expect(rejectUnsafeUsername('bob')).toBeUndefined()
  })
})

describe('rejectUnsafeLabel', () => {
  it('rejects values starting with a dash', () => {
    expect(rejectUnsafeLabel('-x')).toBeDefined()
  })

  it('rejects labels containing a comma', () => {
    expect(rejectUnsafeLabel('area: db,cache')).toBeDefined()
  })

  it('allows plain labels', () => {
    expect(rejectUnsafeLabel('enhancement')).toBeUndefined()
  })

  it('allows labels containing a colon', () => {
    expect(rejectUnsafeLabel('area: db')).toBeUndefined()
  })

  it('allows labels containing whitespace', () => {
    expect(rejectUnsafeLabel('good first issue')).toBeUndefined()
  })
})
