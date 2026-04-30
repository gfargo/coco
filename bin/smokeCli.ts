import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { spawnSync } from 'child_process'

type CommandCheck = {
  command: string
  args: string[]
  label: string
  cwd?: string
  env?: NodeJS.ProcessEnv
}

function runCheck({ command, args, label, cwd = process.cwd(), env }: CommandCheck): string {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf-8',
    env: env ? { ...process.env, ...env } : process.env,
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

function assertOutputIncludes(label: string, output: string, expected: string): void {
  if (!output.includes(expected)) {
    throw new Error(`${label} did not include ${expected}:\n${output}`)
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

function createSmokeRepo(root: string): string {
  const repo = join(root, 'repo')

  mkdirSync(repo)
  runCheck({
    command: 'git',
    args: ['init', '--initial-branch=main'],
    cwd: repo,
    label: 'smoke repo init',
  })
  runCheck({
    command: 'git',
    args: ['config', 'user.name', 'Coco Smoke'],
    cwd: repo,
    label: 'smoke repo user name',
  })
  runCheck({
    command: 'git',
    args: ['config', 'user.email', 'smoke@example.com'],
    cwd: repo,
    label: 'smoke repo user email',
  })
  writeFileSync(join(repo, 'README.md'), '# Smoke repo\n', 'utf8')
  runCheck({
    command: 'git',
    args: ['add', 'README.md'],
    cwd: repo,
    label: 'smoke repo add',
  })
  runCheck({
    command: 'git',
    args: ['commit', '-m', 'feat: smoke log command'],
    cwd: repo,
    label: 'smoke repo commit',
  })

  return repo
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
  runHelpCheck({
    command: packagedBinPath(prefix),
    args: ['log', '--help'],
    label: 'packaged log command help',
  })
  runHelpCheck({
    command: packagedBinPath(prefix),
    args: ['ui', '--help'],
    label: 'packaged ui command help',
  })
  runCheck({
    command: packagedBinPath(prefix),
    args: ['init', '--dry-run', '--scope', 'project'],
    label: 'packaged init dry run',
  })
  console.log('✓ packaged init dry run')

  const smokeRepo = createSmokeRepo(tempRoot)
  const logOutput = runCheck({
    command: packagedBinPath(prefix),
    args: ['log', '--limit', '1'],
    cwd: smokeRepo,
    label: 'packaged log command',
    env: { NO_COLOR: '1' },
  })
  assertOutputIncludes('packaged log command', logOutput, 'feat: smoke log command')
  console.log('✓ packaged log command')

  const interactiveLogOutput = runCheck({
    command: packagedBinPath(prefix),
    args: ['log', '--interactive', '--limit', '1'],
    cwd: smokeRepo,
    label: 'packaged non-TTY interactive log command',
    env: { NO_COLOR: '1' },
  })
  assertOutputIncludes('packaged non-TTY interactive log command', interactiveLogOutput, 'coco ui')
  assertOutputIncludes(
    'packaged non-TTY interactive log command',
    interactiveLogOutput,
    'feat: smoke log command'
  )
  console.log('✓ packaged non-TTY interactive log command')

  const uiOutput = runCheck({
    command: packagedBinPath(prefix),
    args: ['ui', '--view', 'history', '--limit', '1'],
    cwd: smokeRepo,
    label: 'packaged non-TTY ui command',
    env: { NO_COLOR: '1' },
  })
  assertOutputIncludes('packaged non-TTY ui command', uiOutput, 'coco ui')
  assertOutputIncludes('packaged non-TTY ui command', uiOutput, 'feat: smoke log command')
  console.log('✓ packaged non-TTY ui command')
} finally {
  rmSync(tempRoot, { recursive: true, force: true })
}
