
import { repairJson } from '../../utils/repairJson';

/**
 * Extract the first complete JSON object from a string by tracking balanced braces
 */
function extractFirstJsonObject(text: string): string | null {
  const startIndex = text.indexOf('{')
  if (startIndex === -1) return null

  let braceCount = 0
  let inString = false
  let escapeNext = false

  for (let i = startIndex; i < text.length; i++) {
    const char = text[i]

    if (escapeNext) {
      escapeNext = false
      continue
    }

    if (char === '\\') {
      escapeNext = true
      continue
    }

    if (char === '"') {
      inString = !inString
      continue
    }

    if (inString) continue

    if (char === '{') {
      braceCount++
    } else if (char === '}') {
      braceCount--
      if (braceCount === 0) {
        // Found the end of the first complete JSON object
        return text.substring(startIndex, i + 1)
      }
    }
  }

  return null
}

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
  
  // Helper function to construct the final message with appends
  const constructMessage = (title: string, body: string): string => {
    const appendedText = append ? `\n\n${append}` : ''
    const ticketFooter = appendTicket && ticketId ? `\n\nPart of **${ticketId}**` : ''
    return `${title}\n\n${body}${appendedText}${ticketFooter}`
  }
  
  // If it's a string, check if it contains a JSON object (including markdown code blocks)
  if (typeof result === 'string') {
    // Early return if string clearly doesn't contain JSON-like content
    if (!result.includes('{') && !result.includes('"title"')) {
      return result
    }

    // Handle multiple markdown code block formats and embedded JSON
    const extractionPatterns = [
      /```(?:json)?\s*(\{[\s\S]*?\})\s*```/,  // Standard markdown blocks
      /`(\{[\s\S]*?\})`/,                     // Inline code blocks
      /^\s*(\{[\s\S]*\})\s*$/,                // Raw JSON without blocks (entire string)
      /(\{[\s\S]*?\})/                        // JSON anywhere in text (fallback)
    ]

    let jsonString = result
    let foundMatch = false

    // Try each pattern to extract JSON
    for (const pattern of extractionPatterns) {
      const match = result.match(pattern)
      if (match && match[1]) {
        jsonString = match[1].trim()
        foundMatch = true
        break
      }
    }

    // Only attempt JSON parsing if we found potential JSON content
    if (foundMatch || jsonString.startsWith('{')) {
      try {
        // Try to parse as JSON to see if it's a stringified object
        const parsed = JSON.parse(jsonString)
        if (parsed &&
            typeof parsed === 'object' &&
            typeof parsed.title === 'string' &&
            typeof parsed.body === 'string' &&
            parsed.title.length > 0 &&
            parsed.body.length > 0) {
          // It's a valid stringified JSON object, format it properly
          return constructMessage(parsed.title, parsed.body)
        }
      } catch {
        // Try to repair the JSON and parse again
        try {
          const repairedJson = repairJson(jsonString)
          const parsed = JSON.parse(repairedJson)
          if (parsed &&
              typeof parsed === 'object' &&
              typeof parsed.title === 'string' &&
              typeof parsed.body === 'string' &&
              parsed.title.length > 0 &&
              parsed.body.length > 0) {
            // Successfully repaired and parsed JSON
            return constructMessage(parsed.title, parsed.body)
          }
        } catch {
          // Repair failed, try extracting just the first complete JSON object
          const firstObject = extractFirstJsonObject(jsonString)
          if (firstObject) {
            try {
              const parsed = JSON.parse(firstObject)
              if (parsed &&
                  typeof parsed === 'object' &&
                  typeof parsed.title === 'string' &&
                  typeof parsed.body === 'string' &&
                  parsed.title.length > 0 &&
                  parsed.body.length > 0) {
                return constructMessage(parsed.title, parsed.body)
              }
            } catch {
              // Even first object extraction failed, continue to fallback
            }
          }
        }
      }
    }

    // If no JSON found and it's already formatted, return as-is
    return result
  }
  
  // If it's already an object with title and body, format it
  if (typeof result === 'object' && result !== null && 
      'title' in result && 'body' in result) {
    const commitMsgObj = result as { title: string; body: string }
    if (typeof commitMsgObj.title === 'string' && typeof commitMsgObj.body === 'string') {
      return constructMessage(commitMsgObj.title, commitMsgObj.body)
    }
  }
  
  // Fallback - convert to string and return as-is
  return String(result)
}