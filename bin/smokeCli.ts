import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { spawnSync } from 'child_process'

type CommandCheck = {
  command: string
  args: string[]
  label: string
}

function runCheck({ command, args, label }: CommandCheck): string {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf-8',
  })

  if (result.error) {
    throw new Error(`${label} failed to start: ${result.error.message}`)
  }

  if (result.status !== 0) {
    throw new Error(
      [
        `${label} exited with status ${result.status}`,
        result.stdout ? `stdout:\n${result.stdout}` : undefined,
        result.stderr ? `stderr:\n${result.stderr}` : undefined,
      ]
        .filter(Boolean)
        .join('\n\n')
    )
  }

  return `${result.stdout}\n${result.stderr}`.trim()
}

function assertHelpOutput(label: string, output: string): void {
  if (!output.includes('coco') || !output.includes('--help')) {
    throw new Error(`${label} did not print expected CLI help output:\n${output}`)
  }
}

function runHelpCheck(check: CommandCheck): void {
  const output = runCheck(check)
  assertHelpOutput(check.label, output)
  console.log(`✓ ${check.label}`)
}

function npmCommand(): string {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

function packagedBinPath(prefix: string): string {
  return process.platform === 'win32'
    ? join(prefix, 'coco.cmd')
    : join(prefix, 'bin', 'coco')
}

const tempRoot = mkdtempSync(join(tmpdir(), 'coco-cli-smoke-'))

try {
  runHelpCheck({
    command: process.execPath,
    args: ['dist/index.js', '--help'],
    label: 'CommonJS entrypoint help',
  })
  runHelpCheck({
    command: process.execPath,
    args: ['dist/index.esm.mjs', '--help'],
    label: 'ESM entrypoint help',
  })

  const packOutput = runCheck({
    command: npmCommand(),
    args: ['pack', '--pack-destination', tempRoot, '--silent'],
    label: 'npm pack',
  })
  const tarball = packOutput.split('\n').find((line) => line.endsWith('.tgz'))

  if (!tarball) {
    throw new Error(`Could not find packed tarball in npm pack output:\n${packOutput}`)
  }

  const prefix = join(tempRoot, 'install')
  runCheck({
    command: npmCommand(),
    args: [
      'install',
      '--global',
      '--prefix',
      prefix,
      '--no-audit',
      '--no-fund',
      '--silent',
      join(tempRoot, tarball),
    ],
    label: 'install packed CLI',
  })
  runHelpCheck({
    command: packagedBinPath(prefix),
    args: ['--help'],
    label: 'packaged binary help',
  })
  runHelpCheck({
    command: packagedBinPath(prefix),
    args: ['commit', '--help'],
    label: 'packaged commit command help',
  })
} finally {
  rmSync(tempRoot, { recursive: true, force: true })
}
