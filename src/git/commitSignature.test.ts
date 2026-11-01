import { describeSignature, isSignatureProblem, parseCommitSignature } from './commitSignature'
import { parseCommitDetail } from './logData'

const SEP = '\x1f'
const meta = (...tail: string[]) =>
  ['h'.repeat(40), 'hhhhhhh', '', '2026-01-01', 'Alice', '', 'subject', 'body', ...tail].join(SEP)

describe('commit signature (#2214)', () => {
  it('treats N and empty as unsigned', () => {
    expect(parseCommitSignature('N', '', '')).toBeUndefined()
    expect(parseCommitSignature(undefined, undefined, undefined)).toBeUndefined()
  })

  it('keeps status, signer and key for a signed commit', () => {
    expect(parseCommitSignature('G', 'Alice <a@x.io>', '0123ABCD')).toEqual({
      status: 'G', signer: 'Alice <a@x.io>', key: '0123ABCD',
    })
  })

  it('parses trailing signature fields out of the detail format, and tolerates their absence', () => {
    expect(parseCommitDetail(meta('G', 'Alice', 'KEY1'), '').signature).toEqual({ status: 'G', signer: 'Alice', key: 'KEY1' })
    expect(parseCommitDetail(meta('N', '', ''), '').signature).toBeUndefined()
    expect(parseCommitDetail(meta(), '').signature).toBeUndefined()
  })

  it('describes each status, flagging bad and revoked as problems', () => {
    expect(describeSignature({ status: 'G', signer: 'Alice', key: 'KEY1' })).toBe('✓ signed by Alice (KEY1)')
    expect(describeSignature({ status: 'U' })).toContain('key not trusted')
    expect(describeSignature({ status: 'B', signer: 'Mallory' })).toBe('✗ BAD signature by Mallory')
    expect(describeSignature({ status: 'E', key: 'KEY2' })).toContain('cannot verify')
    expect(describeSignature({ status: 'G' }, true)).toBe('[ok] signed')
    expect(isSignatureProblem({ status: 'B' })).toBe(true)
    expect(isSignatureProblem({ status: 'R' })).toBe(true)
    expect(isSignatureProblem({ status: 'G' })).toBe(false)
  })
})
