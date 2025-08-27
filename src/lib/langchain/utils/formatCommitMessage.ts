/**
 * Utility function to ensure commit messages are properly formatted as strings
 * rather than JSON objects, whether they come as parsed objects or stringified JSON
 */
export function formatCommitMessage(
  result: string | { title: string; body: string } | unknown,
  options: {
    append?: string
    ticketId?: string
    appendTicket?: boolean
  } = {}
): string {
  const { append, ticketId, appendTicket } = options
  
  // If it's a string, check if it contains a JSON object
  if (typeof result === 'string') {
    try {
      // Try to parse as JSON to see if it's a stringified object
      const parsed = JSON.parse(result)
      if (parsed && typeof parsed === 'object' && parsed.title && parsed.body) {
        // It's a stringified JSON object, format it properly
        const appendedText = append ? `\n\n${append}` : ''
        const ticketFooter = appendTicket && ticketId ? `\n\nPart of **${ticketId}**` : ''
        return `${parsed.title}\n\n${parsed.body}${appendedText}${ticketFooter}`
      }
    } catch {
      // Not valid JSON, treat as regular string
    }
    return result
  }
  
  // If it's already an object with title and body, format it
  if (typeof result === 'object' && result !== null && 'title' in result && 'body' in result) {
    const commitMsgObj = result as { title: string; body: string }
    const appendedText = append ? `\n\n${append}` : ''
    const ticketFooter = appendTicket && ticketId ? `\n\nPart of **${ticketId}**` : ''
    return `${commitMsgObj.title}\n\n${commitMsgObj.body}${appendedText}${ticketFooter}`
  }
  
  // Fallback - convert to string
  return String(result)
}