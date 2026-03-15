export interface BaseAdapter {
  run(prompt: string, options?: Record<string, string>, apiKey?: string): Promise<void>
}

export type AutoFixConfig = {
  autoFixTool?: string
  autoFixToolOptions?: Record<string, string>
  apiKey?: string
}
