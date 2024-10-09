
export function extractTicketIdFromBranchName(branchName: string): string | null {
    const regex = /((?<!([A-Z]+)-?)[A-Z]+-\d+)/;
    const match = branchName.match(regex);
    return match ? match[0] : null;
}
