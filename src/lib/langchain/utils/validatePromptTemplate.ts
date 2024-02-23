/**
 * Verify  template string contains all required input variables
 * @param text template string
 * @param inputVariables template variables
 * @returns boolean or error message
 */

export function validatePromptTemplate(text: string, inputVariables: string[]) {
  if (!text) {
    return 'Prompt template cannot be empty';
  }

  if (!inputVariables.some((entry) => text.includes(entry))) {
    return (
      'Prompt template must include at least one of the following input variables: ' +
      inputVariables.map((value) => `{${value}}`).join(', ')
    );
  }

  return true;
}
