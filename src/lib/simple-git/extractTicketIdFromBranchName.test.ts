import { extractTicketIdFromBranchName } from './extractTicketIdFromBranchName'

describe('extractTicketIdFromBranchName', () => {
  it('should extract ticket ID from a valid branch name', () => {
    const branchName = 'feature/PROJ-1234-add-new-feature'
    const ticketId = extractTicketIdFromBranchName(branchName)
    expect(ticketId).toBe('PROJ-1234')
  })

  it('should extract ticket ID from a branch name with multiple words', () => {
    const branchName = 'bugfix/PROJECT-1234-fix-issue'
    const ticketId = extractTicketIdFromBranchName(branchName)
    expect(ticketId).toBe('PROJECT-1234')
  })

  it('should extract ticket ID from a branch name at the beginning', () => {
    const branchName = 'PRJKT-123-feature/add-new-feature'
    const ticketId = extractTicketIdFromBranchName(branchName)
    expect(ticketId).toBe('PRJKT-123')
  })

  it('should extract ticket ID solely from a branch name', () => {
    const branchName = 'PRJCT-1337'
    const ticketId = extractTicketIdFromBranchName(branchName)
    expect(ticketId).toBe('PRJCT-1337')
  })

  it('should extract ticket ID from a branch name at the end', () => {
    const branchName = 'feature/add-new-feature-PROJECT-1234'
    const ticketId = extractTicketIdFromBranchName(branchName)
    expect(ticketId).toBe('PROJECT-1234')
  })

  it('should return null for a branch name without a ticket ID', () => {
    const branchName = 'feature/add-new-feature'
    const ticketId = extractTicketIdFromBranchName(branchName)
    expect(ticketId).toBeNull()
  })

  it('should extract ticket ID from a branch name with multiple IDs', () => {
    const branchName = 'bugfix/PROJ-5432-PROJ-123-fix-issue'
    const ticketId = extractTicketIdFromBranchName(branchName)
    expect(ticketId).toBe('PROJ-5432')
  })

  it('should avoid matching against lowercase branch names', () => {
    const branchName = 'hotfix/project-1234-fix-urgent-issue'
    const ticketId = extractTicketIdFromBranchName(branchName)
    expect(ticketId).toBeNull()
  })
})
