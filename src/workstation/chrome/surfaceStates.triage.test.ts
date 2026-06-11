import {
  formatLogInkForgeNoRemote,
  formatLogInkForgeUnauthenticated,
  formatLogInkIssuesEmpty,
  formatLogInkPullRequestTriageEmpty,
} from './surfaceStates'

describe('triage surface empty-state messages', () => {
  describe('formatLogInkIssuesEmpty', () => {
    it('mentions the filter when one is active', () => {
      expect(formatLogInkIssuesEmpty({ filter: 'auth' })).toContain("'auth'")
      expect(formatLogInkIssuesEmpty({ filter: 'auth' })).toContain('ctrl+u')
    })

    it('references the default open-issues filter when none is set', () => {
      const msg = formatLogInkIssuesEmpty({ filter: '' })
      expect(msg).toContain('open')
      expect(msg).not.toContain("''")
    })

    it('is forge-neutral (no hardcoded GitHub)', () => {
      expect(formatLogInkIssuesEmpty({ filter: '' })).not.toContain('GitHub')
    })
  })

  describe('formatLogInkPullRequestTriageEmpty', () => {
    it('mentions the filter when one is active', () => {
      expect(formatLogInkPullRequestTriageEmpty({ filter: 'merge' })).toContain("'merge'")
    })

    it('references the default open-PRs filter when none is set', () => {
      expect(formatLogInkPullRequestTriageEmpty({ filter: '' })).toContain('open')
    })
  })

  describe('formatLogInkForgeUnauthenticated', () => {
    it('embeds the resource noun', () => {
      expect(formatLogInkForgeUnauthenticated({ resource: 'Issues' })).toContain('Issues')
      expect(formatLogInkForgeUnauthenticated({ resource: 'Pull requests' })).toContain(
        'Pull requests'
      )
    })

    it('points the user at gh auth login by default (GitHub)', () => {
      expect(formatLogInkForgeUnauthenticated({ resource: 'Issues' })).toContain('gh auth login')
      expect(formatLogInkForgeUnauthenticated({ resource: 'Issues' })).toContain('GitHub')
    })

    it('points the user at glab auth login for GitLab', () => {
      const msg = formatLogInkForgeUnauthenticated({
        resource: 'Merge requests',
        cli: 'glab',
        forge: 'GitLab',
      })
      expect(msg).toContain('glab auth login')
      expect(msg).toContain('GitLab')
      expect(msg).not.toContain('gh auth login')
    })
  })

  describe('formatLogInkForgeNoRemote', () => {
    it('embeds the resource noun', () => {
      expect(formatLogInkForgeNoRemote({ resource: 'Issues' })).toContain('Issues')
    })

    it('mentions GitHub by default and GitLab when asked', () => {
      expect(formatLogInkForgeNoRemote({ resource: 'Issues' })).toContain('GitHub')
      expect(formatLogInkForgeNoRemote({ resource: 'Issues', forge: 'GitLab' })).toContain('GitLab')
    })
  })
})
