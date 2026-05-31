import { CommitSplitPlanSchema } from './splitPlanTypes'

describe('CommitSplitPlanSchema', () => {
  it('parses a group that only supplies files (no hunks key)', () => {
    const parsed = CommitSplitPlanSchema.parse({
      groups: [{ title: 'feat: add login', files: ['src/auth/login.ts'] }],
    })

    expect(parsed.groups[0].files).toEqual(['src/auth/login.ts'])
    // Missing `hunks` is accepted (left undefined) rather than throwing "Required".
    expect(parsed.groups[0].hunks).toBeUndefined()
  })

  it('parses a group that only supplies hunks (no files key)', () => {
    const parsed = CommitSplitPlanSchema.parse({
      groups: [{ title: 'fix: tweak handler', hunks: ['src/server.ts:1'] }],
    })

    expect(parsed.groups[0].hunks).toEqual(['src/server.ts:1'])
    expect(parsed.groups[0].files).toBeUndefined()
  })

  it('parses a plan that mixes files-only and hunks-only groups', () => {
    // This is the exact shape the model emits that previously triggered
    // OUTPUT_PARSING_FAILURE: each group carries either files or hunks, not both.
    const parsed = CommitSplitPlanSchema.parse({
      groups: [
        { title: 'feat: file-level group', files: ['a.ts', 'b.ts'] },
        { title: 'refactor: hunk-level group', hunks: ['c.ts:0', 'c.ts:1'] },
      ],
    })

    expect(parsed.groups).toHaveLength(2)
    expect(parsed.groups[0].hunks).toBeUndefined()
    expect(parsed.groups[1].files).toBeUndefined()
  })

  it('still rejects a group with neither files nor hunks', () => {
    expect(() =>
      CommitSplitPlanSchema.parse({ groups: [{ title: 'empty group' }] })
    ).toThrow(/at least one file or hunk/)
  })

  it('still rejects a plan with no groups', () => {
    expect(() => CommitSplitPlanSchema.parse({ groups: [] })).toThrow()
  })
})
