import { startCocoMcpServer } from '../../mcp/server'
import { resolveAgentRepoRoot } from '../../operations/agent'
import { armNonInteractiveUsageTelemetry } from '../utils/usageTelemetry'
import { McpArgv } from './config'

export async function handler(argv: McpArgv): Promise<void> {
  const repoRoot = await resolveAgentRepoRoot(argv.repo)
  // Bind config discovery to one repository for the lifetime of this stdio
  // server. Tool calls may not switch roots, avoiding process-wide cwd races.
  process.chdir(repoRoot)
  await armNonInteractiveUsageTelemetry(argv, repoRoot)
  await startCocoMcpServer(repoRoot)
}
