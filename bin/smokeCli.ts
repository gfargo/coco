import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { ChildProcess, spawn, spawnSync } from 'child_process'
import { pathToFileURL } from 'url'
import { PROVIDER_API_KEY_ENV_VARS } from '../src/lib/config/services/env'

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

const MCP_HANDSHAKE_TIMEOUT_MS = 15_000

interface JsonRpcMessage {
  jsonrpc?: string
  id?: number | string
  method?: string
  params?: Record<string, unknown>
  result?: unknown
  error?: { code: number; message: string }
}

interface InitializeResult {
  protocolVersion?: string
  serverInfo?: { name?: string; version?: string }
  capabilities?: { tools?: unknown }
}

interface McpToolDescriptor {
  name: string
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean }
}

interface ToolsListResult {
  tools: McpToolDescriptor[]
}

/**
 * Minimal newline-delimited JSON-RPC client for driving the MCP server's
 * real stdio transport (SDK 1.29's ReadBuffer/serializeMessage frame each
 * message as `JSON.stringify(message) + '\n'`; there is no Content-Length
 * framing). Malformed or non-JSON-RPC stdout fails every pending and future
 * request immediately instead of waiting for a timeout.
 */
function createJsonRpcStdioClient(child: ChildProcess) {
  if (!child.stdin || !child.stdout) {
    throw new Error('MCP server child process did not expose piped stdio')
  }
  const stdin = child.stdin
  // Every non-empty stdout line, whether or not it parsed as JSON-RPC — the
  // source of truth for the end-of-run purity check. A malformed line that
  // arrives with nothing pending (no request awaiting a reply) never
  // resolves or rejects anything in-band, so it must be re-checked here
  // rather than relying on already-parsed messages.
  const rawStdoutLines: string[] = []
  const pendingRequests = new Map<number, { resolve: (message: JsonRpcMessage) => void; reject: (error: Error) => void }>()
  const requestHandlers = new Map<string, (message: JsonRpcMessage) => void>()
  let buffer = ''
  let nextId = 1
  let fatalError: Error | undefined

  function failAll(error: Error): void {
    if (fatalError) return
    fatalError = error
    for (const pending of pendingRequests.values()) {
      pending.reject(error)
    }
    pendingRequests.clear()
  }

  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    buffer += chunk
    let newlineIndex = buffer.indexOf('\n')
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex).replace(/\r$/, '')
      buffer = buffer.slice(newlineIndex + 1)
      if (line.length > 0) {
        rawStdoutLines.push(line)
        try {
          const message = JSON.parse(line) as JsonRpcMessage
          if (message.jsonrpc !== '2.0') {
            failAll(new Error(`MCP server wrote non-JSON-RPC data to stdout: ${line}`))
          } else if (typeof message.id !== 'undefined' && ('result' in message || 'error' in message)) {
            const pending = pendingRequests.get(Number(message.id))
            if (pending) {
              pendingRequests.delete(Number(message.id))
              pending.resolve(message)
            }
          } else if (typeof message.method === 'string') {
            requestHandlers.get(message.method)?.(message)
          }
        } catch {
          failAll(new Error(`MCP server wrote non-JSON-RPC data to stdout: ${line}`))
        }
      }
      newlineIndex = buffer.indexOf('\n')
    }
  })

  function send(message: JsonRpcMessage): void {
    stdin.write(`${JSON.stringify(message)}\n`)
  }

  function request(method: string, params?: Record<string, unknown>, timeoutMs = MCP_HANDSHAKE_TIMEOUT_MS): Promise<JsonRpcMessage> {
    const id = nextId++
    return new Promise((resolve, reject) => {
      if (fatalError) {
        reject(fatalError)
        return
      }
      const timer = setTimeout(() => {
        pendingRequests.delete(id)
        reject(new Error(
          `MCP server never answered '${method}' within ${timeoutMs}ms — likely died before responding ` +
          '(deferred-binding regression) or the stdio framing changed.'
        ))
      }, timeoutMs)
      pendingRequests.set(id, {
        resolve: (message) => {
          clearTimeout(timer)
          resolve(message)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        },
      })
      send({ jsonrpc: '2.0', id, method, params })
    })
  }

  function notify(method: string, params?: Record<string, unknown>): void {
    send({ jsonrpc: '2.0', method, params })
  }

  function respond(id: number | string, result: unknown): void {
    send({ jsonrpc: '2.0', id, result })
  }

  function onRequest(method: string, handler: (message: JsonRpcMessage) => void): void {
    requestHandlers.set(method, handler)
  }

  return { request, notify, respond, onRequest, rawStdoutLines }
}

/**
 * Spawns the built MCP server from a genuinely non-git cwd and drives a real
 * initialize/tools-list handshake over stdio. This is the only test surface
 * that would have caught two regressions source-level tests structurally
 * cannot: the server dying before responding when cwd is not a git repo
 * (deferred binding), and a switch away from newline-delimited framing.
 */
async function runMcpHandshakeSmoke(): Promise<void> {
  const nonGitCwd = mkdtempSync(join(tmpdir(), 'coco-mcp-nongit-'))
  const scenarioRoot = mkdtempSync(join(tmpdir(), 'coco-mcp-repo-'))
  let child: ChildProcess | undefined

  try {
    const gitCheck = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: nonGitCwd })
    if (gitCheck.status === 0) {
      throw new Error(
        `Expected ${nonGitCwd} to be outside any git repository, but 'git rev-parse --is-inside-work-tree' ` +
        'succeeded there. The deferred-binding regression guard requires a genuinely non-git cwd.'
      )
    }

    const repo = createSmokeRepo(scenarioRoot)

    const env = { ...process.env }
    // Strip every provider-scoped API key env var coco recognizes (single
    // source of truth: PROVIDER_API_KEY_ENV_VARS in env.ts) plus the
    // non-key service vars that could otherwise point the server at a live
    // provider, so this smoke test can never make a real network call.
    for (const key of Object.keys(PROVIDER_API_KEY_ENV_VARS)) {
      delete env[key]
    }
    delete env.OPENAI_API_BASE
    delete env.OLLAMA_HOST
    env.NO_COLOR = '1'

    child = spawn(process.execPath, [join(process.cwd(), 'dist/index.js'), 'mcp'], {
      cwd: nonGitCwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const spawnedChild = child

    let stderrOutput = ''
    spawnedChild.stderr?.setEncoding('utf8')
    spawnedChild.stderr?.on('data', (chunk: string) => {
      stderrOutput += chunk
    })

    const childFailure = new Promise<never>((_, reject) => {
      spawnedChild.once('error', (error) => {
        reject(new Error(`Failed to spawn the MCP server: ${error.message}`))
      })
      spawnedChild.once('exit', (code, signal) => {
        reject(new Error(
          `MCP server exited early (code=${code}, signal=${signal}) before completing the handshake.` +
          (stderrOutput ? `\nstderr:\n${stderrOutput}` : '')
        ))
      })
    })
    childFailure.catch(() => {})

    const client = createJsonRpcStdioClient(spawnedChild)

    client.onRequest('roots/list', (message) => {
      if (typeof message.id !== 'undefined') {
        client.respond(message.id, {
          roots: [{ uri: pathToFileURL(repo).toString(), name: 'smoke-repo' }],
        })
      }
    })

    const initializeResponse = await Promise.race([
      client.request('initialize', {
        protocolVersion: '2025-03-26',
        capabilities: { roots: { listChanged: true } },
        clientInfo: { name: 'coco-smoke', version: '0.0.0' },
      }),
      childFailure,
    ])
    const initializeResult = initializeResponse.result as InitializeResult | undefined
    if (!initializeResult?.protocolVersion) {
      throw new Error(`initialize result is missing protocolVersion:\n${JSON.stringify(initializeResponse)}`)
    }
    if (initializeResult.serverInfo?.name !== 'coco') {
      throw new Error(`initialize result serverInfo.name expected 'coco', got:\n${JSON.stringify(initializeResponse)}`)
    }
    if (!initializeResult.capabilities?.tools) {
      throw new Error(`initialize result is missing capabilities.tools:\n${JSON.stringify(initializeResponse)}`)
    }
    console.log('✓ MCP initialize handshake (non-git cwd)')

    client.notify('notifications/initialized')

    const toolsListResponse = await Promise.race([client.request('tools/list'), childFailure])
    const tools = (toolsListResponse.result as ToolsListResult | undefined)?.tools ?? []
    const expectedNames = ['coco_commit_draft', 'coco_review', 'coco_changelog', 'coco_recap', 'coco_condense_diff', 'coco_repo_context', 'coco_blame', 'coco_lint', 'coco_capabilities']
    const actualNames = [...tools.map((tool) => tool.name)].sort()
    if (JSON.stringify(actualNames) !== JSON.stringify([...expectedNames].sort())) {
      throw new Error(`tools/list returned an unexpected tool set.\nExpected: ${expectedNames.join(', ')}\nActual: ${actualNames.join(', ')}`)
    }
    for (const tool of tools) {
      if (tool.annotations?.readOnlyHint !== true || tool.annotations?.destructiveHint !== false) {
        throw new Error(`Tool '${tool.name}' has unexpected annotations: ${JSON.stringify(tool.annotations)}`)
      }
    }
    console.log('✓ MCP tools/list (expected tool set, read-only annotations)')

    const toolCallResponse = await Promise.race([
      client.request('tools/call', {
        name: 'coco_review',
        arguments: { source: { kind: 'summary', summary: 'Smoke test summary for MCP dispatch.' } },
      }),
      childFailure,
    ])
    if (toolCallResponse.jsonrpc !== '2.0' || typeof toolCallResponse.id === 'undefined') {
      throw new Error(`tools/call response was not well-formed JSON-RPC:\n${JSON.stringify(toolCallResponse)}`)
    }
    console.log('✓ MCP tools/call dispatch (coco_review, summary source)')

    // Re-validate every raw stdout line the server ever wrote, including
    // any that failed to parse — a malformed (non-JSON) line is exactly the
    // failure this assertion exists to catch.
    for (const line of client.rawStdoutLines) {
      let message: JsonRpcMessage
      try {
        message = JSON.parse(line) as JsonRpcMessage
      } catch {
        throw new Error(`Non-JSON-RPC data reached stdout: ${line}`)
      }
      if (message.jsonrpc !== '2.0') {
        throw new Error(`Non-JSON-RPC data reached stdout: ${line}`)
      }
    }
    console.log('✓ MCP stdout carries only JSON-RPC')
  } finally {
    child?.kill()
    rmSync(nonGitCwd, { recursive: true, force: true })
    rmSync(scenarioRoot, { recursive: true, force: true })
  }
}

async function main(): Promise<void> {
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
      args: ['blame', '--help'],
      label: 'packaged blame command help',
    })
    runHelpCheck({
      command: packagedBinPath(prefix),
      args: ['ui', '--help'],
      label: 'packaged ui command help',
    })
    runHelpCheck({
      command: packagedBinPath(prefix),
      args: ['workspace', '--help'],
      label: 'packaged workspace command help',
    })
    runCheck({
      command: packagedBinPath(prefix),
      args: ['init', '--dry-run', '--scope', 'project'],
      label: 'packaged init dry run',
    })
    console.log('✓ packaged init dry run')

    const bashCompletionOutput = runCheck({
      command: packagedBinPath(prefix),
      args: ['completion'],
      label: 'packaged bash completion script',
      env: { SHELL: '/bin/bash' },
    })
    assertOutputIncludes('packaged bash completion script', bashCompletionOutput, '_coco_yargs_completions')
    console.log('✓ packaged bash completion script')

    const fishCompletionOutput = runCheck({
      command: packagedBinPath(prefix),
      args: ['completion', 'fish'],
      label: 'packaged fish completion script',
    })
    assertOutputIncludes('packaged fish completion script', fishCompletionOutput, 'complete -c coco')
    console.log('✓ packaged fish completion script')

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

    const blameOutput = runCheck({
      command: packagedBinPath(prefix),
      args: ['blame', 'README.md'],
      cwd: smokeRepo,
      label: 'packaged blame command',
      env: { NO_COLOR: '1' },
    })
    assertOutputIncludes('packaged blame command', blameOutput, 'Coco Smoke')
    console.log('✓ packaged blame command')

    const interactiveLogOutput = runCheck({
      command: packagedBinPath(prefix),
      args: ['log', '--interactive', '--limit', '1'],
      cwd: smokeRepo,
      label: 'packaged non-TTY interactive log command',
      env: { NO_COLOR: '1' },
    })
    assertOutputIncludes('packaged non-TTY interactive log command', interactiveLogOutput, 'coco')
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
    assertOutputIncludes('packaged non-TTY ui command', uiOutput, 'coco')
    assertOutputIncludes('packaged non-TTY ui command', uiOutput, 'feat: smoke log command')
    console.log('✓ packaged non-TTY ui command')

    await runMcpHandshakeSmoke()
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error)
  process.exitCode = 1
})
