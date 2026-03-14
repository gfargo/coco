export interface BaseAdapter {
  /**
   * Spawn the AI CLI tool with the given prompt and options.
   * Must use spawn with stdio: 'inherit' so output streams to the terminal.
   * Resolves when the child process exits with code 0.
   * Rejects with an error containing the exit code on non-zero exit.
   */
  run(prompt: string, options?: Record<string, string>): Promise<void>
}

export type AutoFixConfig = {
  autoFixTool?: string
  autoFixToolOptions?: Record<string, string>
}
