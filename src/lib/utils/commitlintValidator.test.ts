import { execFile } from 'node:child_process'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

type ValidationResult = {
  valid: boolean
  errors: string[]
  warnings: string[]
}

async function validateWithNativeEsm(message: string): Promise<ValidationResult> {
  const moduleUrl = pathToFileURL(
    path.resolve(process.cwd(), 'src/lib/utils/commitlintValidator.ts'),
  ).href
  const script = `
    const loaded = await import(${JSON.stringify(moduleUrl)});
    const validate = loaded.validateConventionalCommitMessage
      ?? loaded.default?.validateConventionalCommitMessage;
    if (!validate) throw new Error('commitlint validator export was not found');
    const result = await validate(${JSON.stringify(message)});
    process.stdout.write(JSON.stringify(result));
  `
  const { stdout } = await execFileAsync(process.execPath, [
    '--import',
    'tsx',
    '--input-type=module',
    '--eval',
    script,
  ], { cwd: process.cwd() })

  return JSON.parse(stdout) as ValidationResult
}

describe('validateConventionalCommitMessage', () => {
  it('accepts a conventional message using built-in rules', async () => {
    await expect(validateWithNativeEsm(
      'feat(agent): expose structured generation',
    )).resolves.toMatchObject({
      valid: true,
      errors: [],
    })
  })

  it('rejects a non-conventional title without loading repository config', async () => {
    const result = await validateWithNativeEsm('Expose structured generation')

    expect(result.valid).toBe(false)
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringMatching(/type may not be empty/i),
    ]))
  })
})
