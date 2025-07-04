/**
 * Verify template string contains all required input variables
 * 
 * @param text template string
 * @param inputVariables template variables
 * @throws Error if validation fails
 */
export function validatePromptTemplate(text: string, inputVariables: string[]): void {
  if (!text || text.trim() === '') {
    throw new Error('Prompt template cannot be empty');
  }

  if (!inputVariables || inputVariables.length === 0) {
    return; // No variables to validate
  }

  // Extract variables from template using regex to find {variable} patterns
  // This regex matches {variable_name} with no whitespace inside braces
  // Excludes JSON-like patterns with quotes, colons, or whitespace
  const templateVariableRegex = /\{([^}\s:"']+)\}/g;
  const foundVariables = new Set<string>();
  let match;
  
  while ((match = templateVariableRegex.exec(text)) !== null) {
    foundVariables.add(match[1]);
  }

  // Check if all required variables are present in template
  const missingVariables = inputVariables.filter(variable => !foundVariables.has(variable));
  
  if (missingVariables.length > 0) {
    throw new Error(
      `Prompt template is missing required variables: ${missingVariables.map(v => `{${v}}`).join(', ')}. ` +
      `Found variables: ${Array.from(foundVariables).map(v => `{${v}}`).join(', ') || 'none'}`
    );
  }

  // Warn about unused variables in template (optional check)
  const unusedVariables = Array.from(foundVariables).filter(variable => !inputVariables.includes(variable));
  if (unusedVariables.length > 0) {
    console.warn(
      `Prompt template contains undefined variables: ${unusedVariables.map(v => `{${v}}`).join(', ')}`
    );
  }
}
