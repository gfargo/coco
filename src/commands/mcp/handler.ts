import { startCocoMcpServer } from '../../mcp/server'
import { resolveAgentRepoRoot } from '../../operations/agent'
import { armNonInteractiveUsageTelemetry } from '../utils/usageTelemetry'
import { McpArgv } from './config'

export async function handler(argv: McpArgv): Promise<void> {
  let repoRoot: string | undefined
  if (argv.repo) {
    repoRoot = await resolveAgentRepoRoot(argv.repo)
    // Bind config discovery to one repository for the lifetime of this stdio
    // server. Tool calls may not switch roots, avoiding process-wide cwd races.
    process.chdir(repoRoot)
    await armNonInteractiveUsageTelemetry(argv, repoRoot)
  }
  // When --repo is omitted, the server starts in deferred-binding mode:
  // the repository is resolved per-call from client roots or tool input.
  await startCocoMcpServer(repoRoot)
}
