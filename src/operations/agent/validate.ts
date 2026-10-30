/**
 * Zero-token commit message tools (#1845): validate a message the caller
 * wrote, and list the rules it is checked against. No model call, no API key,
 * no network, no config load. An agent can call them on every commit.
 *
 * Both use coco's built-in Conventional Commits rules. Repository commitlint
 * config is executable JavaScript and is never loaded here; its presence is
 * reported (by file check only) so the caller can tell an authoritative pass
 * from an advisory one.
 */
import {
  describeBuiltInConventionalRules,
  lintWithBuiltInConventionalRules,
} from '../../lib/utils/commitlintValidator'
import { digestOf, hasCommitlintConfigAtRoot } from './context'
import {
  AGENT_PROTOCOL_VERSION,
  AgentOperation,
  AgentSuccessEnvelope,
  CommitlintRulesData,
  CommitlintRulesRequest,
  CommitValidateData,
  CommitValidateRequest,
} from './schemas'

function repositoryConfig(repoRoot: string | undefined): CommitValidateData['repositoryConfig'] {
  if (!repoRoot) return 'unknown'
  return hasCommitlintConfigAtRoot(repoRoot) ? 'detected' : 'absent'
}

/** `meta` describes the caller-supplied input the result was computed from. */
function envelope<T>(operation: AgentOperation, data: T, warnings: string[], input: string): AgentSuccessEnvelope<T> {
  return {
    version: AGENT_PROTOCOL_VERSION,
    ok: true,
    operation,
    status: 'completed',
    data,
    warnings,
    meta: { kind: 'summary', digest: digestOf(input), verification: 'provided-unverified' },
  }
}

const ADVISORY_WARNING =
  'The repository defines its own commitlint config, which agent tools do not load. This result uses the built-in Conventional Commits rules, so it may not match the repository\'s rules.'

export async function runCommitValidate(
  input: CommitValidateRequest,
  repoRoot: string | undefined,
): Promise<AgentSuccessEnvelope<CommitValidateData>> {
  const result = await lintWithBuiltInConventionalRules(input.message)
  const config = repositoryConfig(repoRoot)
  return envelope('commit-validate', {
    valid: result.valid,
    errors: result.errors,
    warnings: result.warnings,
    rulesSource: 'built-in-conventional',
    repositoryConfig: config,
  }, config === 'detected' ? [ADVISORY_WARNING] : [], input.message)
}

export async function runCommitlintRules(
  _input: CommitlintRulesRequest,
  repoRoot: string | undefined,
): Promise<AgentSuccessEnvelope<CommitlintRulesData>> {
  const config = repositoryConfig(repoRoot)
  return envelope('commitlint-rules', {
    rules: describeBuiltInConventionalRules(),
    rulesSource: 'built-in-conventional',
    repositoryConfig: config,
  }, config === 'detected' ? [ADVISORY_WARNING] : [], 'built-in-conventional')
}
