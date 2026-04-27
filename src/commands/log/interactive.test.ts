import { GitCommitDetail, GitLogRow } from './data'
import { createLogTuiState } from './interactiveState'
import { renderInteractiveLog } from './interactive'

const rows: GitLogRow[] = [
  {
    type: 'commit',
    graph: '*',
    shortHash: 'abc1234',
    hash: 'abc1234',
    date: '2026-04-27',
    author: 'Coco Test',
    refs: ['HEAD -> main'],
    message: 'feat: add interactive log',
  },
]

const detail: GitCommitDetail = {
  shortHash: 'abc1234',
  hash: 'abc1234',
  date: '2026-04-27',
  author: 'Coco Test',
  refs: ['HEAD -> main'],
  message: 'feat: add interactive log',
  body: 'Adds the first terminal UI.',
  files: [
    {
      status: 'A',
      path: 'src/commands/log/interactive.ts',
    },
  ],
}

describe('log interactive renderer', () => {
  it('renders commit navigation, selected details, changed files, and help', () => {
    const output = renderInteractiveLog(createLogTuiState(rows), detail, {
      height: 40,
      width: 100,
    })

    expect(output).toContain('coco log')
    expect(output).toContain('1/1 commits')
    expect(output).toContain('feat: add interactive log')
    expect(output).toContain('Changed files:')
    expect(output).toContain('A  src/commands/log/interactive.ts')
    expect(output).toContain('Keys:')
  })
})
