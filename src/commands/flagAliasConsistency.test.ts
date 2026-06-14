import { options as commitOptions } from './commit/config'
import { options as logOptions } from './log/config'
import { options as changelogOptions } from './changelog/config'

/**
 * Guards the short-flag reconciliation from #1245: the two letters that
 * previously meant different things across commands now resolve to one flag
 * each. `-t` is `--tag` (changelog) and `-c` is `--conventional` (commit); the
 * conflicting `commit --appendTicket -t` and `log --commit -c` aliases were
 * dropped (long forms remain).
 */
describe('short-flag alias consistency (#1245)', () => {
  it('reserves -t for changelog --tag only', () => {
    expect(changelogOptions.tag.alias).toBe('t')
    expect(commitOptions.appendTicket.alias).toBeUndefined()
  })

  it('reserves -c for commit --conventional only', () => {
    expect(commitOptions.conventional.alias).toBe('c')
    expect(logOptions.commit.alias).toBeUndefined()
  })
})
