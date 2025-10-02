/**
 * Utility to repair common JSON formatting issues that LLMs make
 * Specifically handles cases where string values are not properly quoted
 */
export function repairJson(jsonString: string): string {
  // Remove any markdown code block wrapping
  let cleaned = jsonString.replace(/```(?:json)?\s*([\s\S]*?)\s*```/g, '$1').trim()

  // Remove inline code block wrapping
  cleaned = cleaned.replace(/^`(.*)`$/, '$1').trim()

  // If it doesn't look like JSON, return as-is
  if (!cleaned.startsWith('{') || !cleaned.endsWith('}')) {
    return jsonString
  }

  try {
    // First try parsing as-is
    JSON.parse(cleaned)
    return cleaned
  } catch {
    // Try to repair common issues
    let repaired = cleaned

    // Fix unquoted string values in title and body fields
    // Pattern: "title": unquoted_value, -> "title": "unquoted_value",
    repaired = repaired.replace(
      /"(title|body)":\s*([^",\{\}\[\]]+?)(?=\s*[,\}])/g,
      (match, field, value) => {
        // Clean up the value (remove leading/trailing whitespace)
        const cleanValue = value.trim()
        // If it's already quoted or looks like a number/boolean, leave it
        if (cleanValue.startsWith('"') || /^(true|false|\d+)$/.test(cleanValue)) {
          return match
        }
        // Quote the value
        return `"${field}": "${cleanValue}"`
      }
    )

    // Fix missing quotes around field names (though this should be rare)
    repaired = repaired.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":')

    // Remove trailing commas before closing braces
    repaired = repaired.replace(/,(\s*[}\]])/g, '$1')

    try {
      // Test if the repair worked
      JSON.parse(repaired)
      return repaired
    } catch {
      // If repair failed, return original
      return jsonString
    }
  }
}
