import {
  formatLogInkGitHubNoRemote,
  formatLogInkGitHubUnauthenticated,
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
  })

  describe('formatLogInkPullRequestTriageEmpty', () => {
    it('mentions the filter when one is active', () => {
      expect(formatLogInkPullRequestTriageEmpty({ filter: 'merge' })).toContain("'merge'")
    })

    it('references the default open-PRs filter when none is set', () => {
      expect(formatLogInkPullRequestTriageEmpty({ filter: '' })).toContain('open')
    })
  })

  describe('formatLogInkGitHubUnauthenticated', () => {
    it('embeds the resource noun', () => {
      expect(formatLogInkGitHubUnauthenticated({ resource: 'Issues' })).toContain('Issues')
      expect(formatLogInkGitHubUnauthenticated({ resource: 'Pull requests' })).toContain(
        'Pull requests'
      )
    })

    it('points the user at gh auth login', () => {
      expect(formatLogInkGitHubUnauthenticated({ resource: 'Issues' })).toContain('gh auth login')
    })
  })

  describe('formatLogInkGitHubNoRemote', () => {
    it('embeds the resource noun', () => {
      expect(formatLogInkGitHubNoRemote({ resource: 'Issues' })).toContain('Issues')
    })

    it('mentions GitHub explicitly', () => {
      expect(formatLogInkGitHubNoRemote({ resource: 'Issues' })).toContain('GitHub')
    })
  })
})
