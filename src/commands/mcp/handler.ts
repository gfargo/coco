import { startCocoMcpServer } from '../../mcp/server'
import { resolveAgentRepoRoot } from '../../operations/agent'
import { armNonInteractiveUsageTelemetry } from '../utils/usageTelemetry'
import { McpArgv } from './config'

export async function handler(argv: McpArgv): Promise<void> {
  let repoRoot: string | undefined
  if (argv.repo) {
    repoRoot = await resolveAgentRepoRoot(argv.repo)
    // Bound mode no longer needs a `chdir` here: config loading (loadConfig
    // → loadProjectJsonConfig/loadGitignore/loadIgnore) and telemetry arming
    // both take an explicit root, so binding to one repository for the
    // lifetime of this stdio server no longer requires mutating process-wide
    // cwd (which used to race against overlapping tool calls).
    await armNonInteractiveUsageTelemetry(argv, repoRoot)
  }
  // When --repo is omitted, the server starts in deferred-binding mode:
  // the repository is resolved per-call from client roots or tool input.
  await startCocoMcpServer(repoRoot, { allowWrite: argv.allowWrite ?? false })
}
