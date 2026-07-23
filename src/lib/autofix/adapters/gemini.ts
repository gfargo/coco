import { spawn } from 'child_process'
import { BaseAdapter } from '../types'

export class GeminiAdapter implements BaseAdapter {
  async run(prompt: string, options?: Record<string, string>, apiKey?: string): Promise<void> {
    const args: string[] = []

    if (options) {
      for (const [key, value] of Object.entries(options)) {
        args.push(`--${key}`, value)
      }
    }

    args.push(prompt)

    // Preserve the caller's environment by default and only override the API key
    // when an explicit non-empty key is provided through auto-fix config.
    const env = { ...process.env }
    if (apiKey) env['GEMINI_API_KEY'] = apiKey

    return new Promise((resolve, reject) => {
      const child = spawn('gemini', args, { stdio: 'inherit', env })

      child.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'ENOENT') {
          reject(
            new Error(
              'gemini binary not found. Please install Gemini CLI: https://ai.google.dev/gemini-api/docs/quickstart'
            )
          )
        } else {
          reject(err)
        }
      })

      child.on('close', (code: number | null) => {
        if (code === 0) {
          resolve()
        } else {
          reject(new Error(`gemini exited with code ${code}`))
        }
      })
    })
  }
}
