/**
 * `eslint` ships no bundled types and `@types/eslint` isn't installed
 * (OSS-2221's lint-rule guard test is the first caller to need the Node
 * API from a `.ts` file). Minimal ambient shape for what the guard test
 * actually calls — not a full re-declaration of the package.
 */
declare module 'eslint' {
  export interface LintMessage {
    ruleId: string | null
    message: string
    line: number
    column: number
  }

  export interface LintResult {
    filePath: string
    messages: LintMessage[]
  }

  export interface ESLintOptions {
    cwd?: string
  }

  export interface LintTextOptions {
    filePath?: string
  }

  export class ESLint {
    constructor(options?: ESLintOptions)
    lintText(code: string, options?: LintTextOptions): Promise<LintResult[]>
  }
}
