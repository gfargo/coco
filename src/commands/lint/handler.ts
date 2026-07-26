import { SimpleGit } from 'simple-git'
import { loadConfig } from '../../lib/config/utils/loadConfig'
import { getApiKeyForModel, getModelAndProviderFromConfig } from '../../lib/langchain/utils'
import { createSchemaParser } from '../../lib/langchain/utils/createSchemaParser'
import { resolveDynamicService } from '../../lib/langchain/utils/dynamicModels'
import { executeChain } from '../../lib/langchain/utils/executeChain'
import { getLanguageContext } from '../../lib/langchain/utils/languageContext'
import { getLlm } from '../../lib/langchain/utils/getLlm'
import { getPrompt } from '../../lib/langchain/utils/getPrompt'
import { LLMModel } from '../../lib/langchain/types'
import {
  checkCommitlintAvailability,
  getCommitlintRulesContext,
  validateCommitMessage,
} from '../../lib/utils/commitlintValidator'
import { CommandHandler } from '../../lib/types'
import { emitJson } from '../../lib/ui/emitJson'
import { FAIL, PASS, WARN } from '../../lib/ui/glyphs'
import { handleMissingApiKey } from '../../lib/ui/handleMissingApiKey'
import { commandExit } from '../../lib/utils/commandExit'
import { getTokenCounterForProvider } from '../../lib/utils/tokenizer'
import { getInProgressOperationType } from '../../git/operationData'
import { executeRebasePlan, RebasePlanRow } from '../../git/rebasePlanActions'
import { applyRepoFlag } from '../utils/applyRepoFlag'
import { LintArgv, LintOptions, LintRewordResponseSchema } from './config'
import { noResult } from './noResult'
import { REWORD_PROMPT } from './prompt'
import { LintLogCommit, parseLintLogOutput, resolveLintRange, LINT_LOG_FORMAT } from './rangeReader'

type LintCommitStatus = 'pass' | 'warn' | 'fail' | 'skipped'

type LintCommitResult = LintLogCommit & {
  status: LintCommitStatus
  errors: string[]
  warnings: string[]
}

const STATUS_GLYPH: Record<LintCommitStatus, string> = {
  pass: PASS(),
  fail: FAIL(),
  warn: WARN(),
  skipped: '◌',
}

async function loadRangeCommits(git: SimpleGit, range: string): Promise<LintLogCommit[]> {
  const output = await git.raw(['log', '--reverse', '--date=short', `--pretty=format:${LINT_LOG_FORMAT}`, range])
  return parseLintLogOutput(output)
}

async function isRangeAlreadyPushed(git: SimpleGit, oldestSha: string): Promise<boolean> {
  let upstream: string
  try {
    upstream = (await git.raw(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'])).trim()
  } catch {
    // No upstream configured — nothing published to conflict with.
    return false
  }

  try {
    await git.raw(['merge-base', '--is-ancestor', oldestSha, upstream])
    return true
  } catch {
    return false
  }
}

function formatCommitReport(results: LintCommitResult[]): string[] {
  const lines: string[] = []
  for (const commit of results) {
    lines.push(`${STATUS_GLYPH[commit.status]} ${commit.shortSha} ${commit.subject}`)
    for (const error of commit.errors) lines.push(`    ${error}`)
    for (const warning of commit.warnings) lines.push(`    ${warning}`)
  }
  return lines
}

export const handler: CommandHandler<LintArgv> = async (argv, logger) => {
  const git = applyRepoFlag(argv)
  const config = loadConfig<LintOptions, LintArgv>(argv)

  const range = resolveLintRange(argv, config.defaultBranch || 'main')

  let commits: LintLogCommit[]
  try {
    commits = await loadRangeCommits(git, range)
  } catch (error) {
    logger.error(
      `Failed to read commit range '${range}': ${(error as Error).message.split('\n')[0]}`,
      { color: 'red' }
    )
    commandExit(1)
    return
  }

  if (commits.length === 0) {
    await noResult({ logger, range })
    if (argv.json) emitJson([])
    commandExit(0)
    return
  }

  const availability = checkCommitlintAvailability()
  if (!availability.available && !argv.json) {
    logger.log(
      `Note: ${availability.missingPackages.join(', ')} not found — falling back to built-in Conventional Commits rules.`,
      { color: 'yellow' }
    )
  }

  const results: LintCommitResult[] = []
  for (const commit of commits) {
    if (commit.parents.length > 1) {
      results.push({ ...commit, status: 'skipped', errors: [], warnings: [] })
      continue
    }

    const fullMessage = commit.body ? `${commit.subject}\n\n${commit.body}` : commit.subject
    const validation = await validateCommitMessage(fullMessage)
    const status: LintCommitStatus =
      validation.errors.length > 0 ? 'fail' : validation.warnings.length > 0 ? 'warn' : 'pass'
    results.push({ ...commit, status, errors: validation.errors, warnings: validation.warnings })
  }

  const severity = argv.severity ?? 'error'
  const failing = results.filter(
    (commit) => commit.status === 'fail' || (severity === 'warning' && commit.status === 'warn')
  )
  const exitCode = failing.length > 0 ? 1 : 0

  if (argv.json) {
    emitJson(
      results.map(({ sha, shortSha, subject, status, errors, warnings }) => ({
        sha,
        shortSha,
        subject,
        status,
        errors,
        warnings,
      }))
    )
    if (!argv.fix) {
      commandExit(exitCode)
      return
    }
  } else {
    logger.log(`Linting ${results.length} commit(s) in ${range}\n`)
    for (const line of formatCommitReport(results)) logger.log(line)

    const passing = results.filter((c) => c.status === 'pass').length
    const warning = results.filter((c) => c.status === 'warn').length
    const skipped = results.filter((c) => c.status === 'skipped').length
    logger.log(
      `\n${passing} passing, ${failing.length} failing, ${warning} warning, ${skipped} skipped`,
      { color: exitCode === 0 ? 'green' : 'red' }
    )
  }

  if (!argv.fix) {
    commandExit(exitCode)
    return
  }

  // --fix: reword non-conforming subjects via an interactive rebase.
  // Refuse on anything that makes rewriting history unsafe unless the
  // user explicitly opts in with --force. Reaching the root commit is
  // never forceable — `executeRebasePlan` has no `--root` support.
  try {
    await git.raw(['rev-parse', '--verify', `${commits[0].sha}^`])
  } catch {
    logger.error('Cannot --fix a range that reaches the root commit.', { color: 'red' })
    commandExit(1)
    return
  }

  const reasons: string[] = []
  const operation = await getInProgressOperationType(git)
  if (operation !== 'none') reasons.push(`a ${operation} is already in progress`)

  const gitStatus = await git.status()
  if (!gitStatus.isClean()) reasons.push('the worktree has uncommitted changes')

  const mergeInRange = commits.some((commit) => commit.parents.length > 1)
  if (mergeInRange) reasons.push('the range contains merge commit(s)')

  const alreadyPushed = await isRangeAlreadyPushed(git, commits[0].sha)
  if (alreadyPushed) reasons.push('the range has already been pushed to its upstream branch')

  if (reasons.length > 0 && !argv.force) {
    logger.error(`Refusing to --fix: ${reasons.join('; ')}.`, { color: 'red' })
    logger.log('Pass --force to override once you understand the risk.', { color: 'yellow' })
    commandExit(1)
    return
  }

  const failingForReword = results.filter((commit) => commit.status === 'fail')
  if (failingForReword.length === 0) {
    logger.log('Nothing to fix — no commit has a commitlint error.', { color: 'green' })
    commandExit(exitCode)
    return
  }

  const key = getApiKeyForModel(config)
  const { provider } = getModelAndProviderFromConfig(config)
  const rewordService = resolveDynamicService(config, 'commit')
  const model = rewordService.model

  if (config.service.authentication.type !== 'None' && !key) {
    handleMissingApiKey(logger, config, { command: 'lint' })
  }

  const tokenizer = await getTokenCounterForProvider(provider, String(model))
  const llm = await getLlm(provider, model as LLMModel, { ...config, service: rewordService })
  const rulesContext = await getCommitlintRulesContext()

  async function proposeReword(commit: LintCommitResult): Promise<string | undefined> {
    let feedback = ''
    for (let attempt = 1; attempt <= 2; attempt++) {
      const prompt = getPrompt({
        template: config.prompt || (REWORD_PROMPT.template as string),
        variables: REWORD_PROMPT.inputVariables,
        fallback: REWORD_PROMPT,
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parser: any = createSchemaParser(LintRewordResponseSchema)
      const variables = {
        subject: commit.subject,
        body: commit.body || '(no body)',
        errors: [...commit.errors, feedback].filter(Boolean).join('\n'),
        commitlint_rules_context: rulesContext,
        format_instructions:
          "Respond with a valid JSON object containing one field: 'subject', a string with the rewritten commit subject line only (no body).",
        language_context: getLanguageContext(argv.language || config.language, {
          taskDescription: 'commit message subject',
          preserveConventionalTokens: true,
        }),
      }

      try {
        const response = await executeChain<{ subject: string }>({
          llm,
          prompt,
          variables,
          parser,
          logger,
          tokenizer,
          metadata: { task: 'lint-reword', command: 'lint', provider, model: String(model) },
        })

        const candidateMessage = commit.body ? `${response.subject}\n\n${commit.body}` : response.subject
        const revalidation = await validateCommitMessage(candidateMessage)
        if (revalidation.errors.length === 0) {
          return response.subject
        }
        feedback = `Still invalid: ${revalidation.errors.join('; ')}`
      } catch (error) {
        logger.verbose(
          `Reword attempt ${attempt} failed for ${commit.shortSha}: ${(error as Error).message}`,
          { color: 'yellow' }
        )
      }
    }
    return undefined
  }

  const rewordBySha = new Map<string, string>()
  for (const commit of failingForReword) {
    const newSubject = await proposeReword(commit)
    if (newSubject) {
      rewordBySha.set(commit.sha, newSubject)
    } else {
      logger.log(`Could not produce a conforming subject for ${commit.shortSha} — leaving unchanged.`, {
        color: 'yellow',
      })
    }
  }

  if (rewordBySha.size === 0) {
    logger.error('No commit could be reworded into a conforming subject.', { color: 'red' })
    commandExit(1)
    return
  }

  const rows: RebasePlanRow[] = commits.map((commit) => {
    const newSubject = rewordBySha.get(commit.sha)
    if (!newSubject) {
      return {
        sha: commit.sha,
        shortSha: commit.shortSha,
        subject: commit.subject,
        author: commit.author,
        date: commit.date,
        action: 'pick',
      }
    }
    return {
      sha: commit.sha,
      shortSha: commit.shortSha,
      subject: commit.subject,
      author: commit.author,
      date: commit.date,
      action: 'reword',
      newMessage: (commit.body ? `${newSubject}\n\n${commit.body}` : newSubject).trim(),
    }
  })

  logger.log('\nProposed rebase plan:', { color: 'blue' })
  for (const row of rows) {
    if (row.action === 'reword') {
      logger.log(`  reword ${row.shortSha}: "${row.subject}" -> "${row.newMessage!.split('\n')[0]}"`)
    } else {
      logger.log(`  pick   ${row.shortSha}: ${row.subject}`, { color: 'gray' })
    }
  }

  const result = await executeRebasePlan(git, rows)
  if (result.ok) {
    logger.log(`\n${result.message}`, { color: 'green' })
  } else {
    logger.error(`\n${result.message}`, { color: 'red' })
    commandExit(1)
    return
  }
}
