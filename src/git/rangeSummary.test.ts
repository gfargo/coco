import { SimpleGit } from 'simple-git'
import { summarizeCompareRange, summaryLines } from './rangeSummary'

const mockRecap = jest.fn()

jest.mock('../operations/agent/context', () => ({
  createAgentOperationContext: jest.fn().mockResolvedValue({ repoRoot: '/repo' }),
}))
jest.mock('../operations/agent/generate', () => ({ generateAgentRecap: (...a: unknown[]) => mockRecap(...a) }))

const fakeGit = (raw: jest.Mock) => ({ raw, revparse: jest.fn().mockResolvedValue('/repo\n') }) as unknown as SimpleGit

beforeEach(() => jest.clearAllMocks())

describe('summaryLines (#2217)', () => {
  it('drops blank lines and trailing whitespace', () => {
    expect(summaryLines('First paragraph.  \n\n\nSecond.\n')).toEqual(['First paragraph.', 'Second.'])
  })
})

describe('summarizeCompareRange (#2217)', () => {
  it('refuses when base and head are the same ref, without touching git or the model', async () => {
    const raw = jest.fn()
    const result = await summarizeCompareRange(fakeGit(raw), 'main', 'main')
    expect(result).toMatchObject({ ok: false, message: expect.stringMatching(/both main/) })
    expect(raw).not.toHaveBeenCalled()
    expect(mockRecap).not.toHaveBeenCalled()
  })

  it('reports nothing to summarize when head adds no commits over base', async () => {
    const result = await summarizeCompareRange(fakeGit(jest.fn().mockResolvedValue('0\n')), 'main', 'feat/x')
    expect(result).toMatchObject({ ok: true, message: expect.stringMatching(/nothing to summarize/) })
    expect(mockRecap).not.toHaveBeenCalled()
  })

  it('reports an unreadable range', async () => {
    const raw = jest.fn().mockRejectedValue(new Error("fatal: bad revision 'nope'\nmore"))
    const result = await summarizeCompareRange(fakeGit(raw), 'nope', 'feat/x')
    expect(result).toMatchObject({ ok: false, message: "Could not read nope...feat/x: fatal: bad revision 'nope'" })
  })

  it('runs the recap on the three-dot branch scope and formats title and summary', async () => {
    const raw = jest.fn().mockResolvedValue('3\n')
    mockRecap.mockResolvedValue({ status: 'completed', data: { title: 'Adds retry logic', summary: 'Wraps calls.\n\nUpdates tests.' } })

    const result = await summarizeCompareRange(fakeGit(raw), 'main', 'feat/x')

    expect(raw).toHaveBeenCalledWith(['rev-list', '--count', 'main..feat/x'])
    expect(mockRecap.mock.calls[0][0].source).toEqual({
      kind: 'repository',
      scope: { type: 'branch', base: 'main', head: 'feat/x' },
    })
    expect(result).toEqual({
      ok: true,
      message: 'feat/x vs main (3 commits): Adds retry logic',
      details: ['Wraps calls.', 'Updates tests.'],
    })
  })

  it('singularizes one commit', async () => {
    mockRecap.mockResolvedValue({ status: 'completed', data: { title: 'T', summary: 'S' } })
    const result = await summarizeCompareRange(fakeGit(jest.fn().mockResolvedValue('1\n')), 'main', 'feat/x')
    expect(result.message).toMatch(/\(1 commit\)/)
  })

  it('returns a non-throwing result when the model is unavailable or only planned', async () => {
    const git = fakeGit(jest.fn().mockResolvedValue('2\n'))
    mockRecap.mockRejectedValue(new Error('No API key\nstack'))
    expect(await summarizeCompareRange(git, 'main', 'feat/x')).toEqual({ ok: false, message: 'Summary unavailable: No API key' })
    mockRecap.mockResolvedValue({ status: 'planned' })
    expect(await summarizeCompareRange(git, 'main', 'feat/x')).toMatchObject({ ok: false })
  })
})
