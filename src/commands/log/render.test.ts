import { GitLogRow } from '../../git/logData'
import { formatLogJson, formatLogTable } from './render'

const rows: GitLogRow[] = [
  {
    type: 'commit',
    graph: '* | | | | *',
    shortHash: 'abc1234',
    hash: 'abc1234',
    parents: ['def5678'],
    date: '2026-04-27',
    author: 'Coco Test',
    refs: ['HEAD -> main', 'tag: 0.33.0', 'origin/main'],
    message: 'feat: preserve graph fidelity',
  },
  {
    type: 'graph',
    graph: '| |/ / /',
  },
  {
    type: 'commit',
    graph: '| *',
    shortHash: 'def5678',
    hash: 'def5678',
    parents: [],
    date: '2026-04-26',
    author: 'dependabot[bot]',
    refs: [],
    message: 'chore(deps): bump dependency',
  },
]

describe('log render layer', () => {
  it('preserves long graph topology and renders refs without dot truncation', () => {
    const output = formatLogTable(rows, { terminalWidth: 160 })

    expect(output).toContain('* | | | | *')
    expect(output).toContain('| |/ / /')
    expect(output).toContain('[HEAD -> main, tag: 0.33.0, origin/main]')
    expect(output).not.toContain('tag: 0.33.0.')
  })

  it('keeps json output focused on commit rows', () => {
    const entries = JSON.parse(formatLogJson(rows))

    expect(entries).toHaveLength(2)
    expect(entries[0]).toEqual(expect.objectContaining({
      type: 'commit',
      graph: '* | | | | *',
      refs: ['HEAD -> main', 'tag: 0.33.0', 'origin/main'],
    }))
  })
})
