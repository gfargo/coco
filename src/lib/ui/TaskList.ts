import chalk from 'chalk'
import { execFile } from 'child_process'
import * as readline from 'readline'
import { promisify } from 'util'
import { SimpleGit } from 'simple-git'
import { ReviewFeedbackItem } from '../../commands/review/config'
import { findingToIssue } from '../../commands/issues/findingToIssue'
import { prepareAutoFix } from '../autofix'
import { AutoFixConfig } from '../autofix/types'
import { getProviderOverview } from '../../git/providerData'
import { getForgeActions } from '../../git/forgeActions'
import { confirmPrompt } from './inquirerPrompts'
import { bannerWithHeader, DIVIDER, hotKey, severityColor, statusColor } from './helpers'
import { confineRepoPath } from '../utils/pathWithinRoot'
import { resolveGitRepoRoot } from '../utils/resolveGitRepoRoot'

const execFileAsync = promisify(execFile)

type FeedbackTaskItem = ReviewFeedbackItem & {
  status: 'pending' | 'completed' | 'skipped' | 'omitted'
}

export class TaskList {
  private items: FeedbackTaskItem[]
  private currentIndex: number = 0
  private rl: readline.Interface
  private config?: AutoFixConfig
  private git?: SimpleGit
  private repoRoot: string

  constructor(items: ReviewFeedbackItem[], config?: AutoFixConfig, git?: SimpleGit, repoRoot?: string) {
    this.items = items.map((item) => ({ ...item, status: 'pending' }))
    this.config = config
    this.git = git
    this.repoRoot = repoRoot ?? resolveGitRepoRoot(process.cwd())
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })
    process.stdin.setRawMode(true)
    readline.emitKeypressEvents(process.stdin)
  }

  private async displayCurrentItem() {
    const item = this.items[this.currentIndex]
    console.clear()

    console.log(
      bannerWithHeader(
        `${DIVIDER} ${this.currentIndex + 1} of ${this.items.length} ${DIVIDER} ${chalk.magenta(
          `Category: ${item.category}`
        )} ${DIVIDER} ${severityColor(item.severity)(
          `Severity: ${item.severity}`
        )} ${DIVIDER} ${statusColor(item.status)(`Status: ${item.status}`)} ${DIVIDER}`
      )
    )
    console.log(this.getColoredBanner(item))
    console.log('\n' + chalk.bold(item.summary) + '\n')
  }

  private getColoredBanner(item: FeedbackTaskItem) {
    return `\n${chalk.bold(item.title)}\n${chalk.dim(`ref: ${item.filePath}`)}`
  }

  private getChoices() {
    const exitText = this.items.every((item) => item.status !== 'pending') ? '✨ Finish' : '🚪 Exit'

    return [
      { name: `✅ Mark as complete ${hotKey('d')}`, value: 'complete' },
      { name: `📂 Open file ${hotKey('o')}`, value: 'open' },
      { name: `🤖 Auto-fix ${hotKey('a')}`, value: 'autofix' },
      { name: `📝 File issue ${hotKey('i')}`, value: 'fileIssue' },
      { name: `⏩ Skip ${hotKey('s')}`, value: 'skip' },
      { name: `🙈 Omit ${hotKey('x')}`, value: 'omit' },
      { name: `${exitText} ${hotKey('q')}`, value: 'exit' },
    ]
  }

  private async openFile() {
    const item = this.items[this.currentIndex]

    const confinement = confineRepoPath(item.filePath, this.repoRoot)
    if (!confinement.ok) {
      const reasonMsg =
        confinement.reason === 'absolute'
          ? 'absolute paths are not allowed'
          : confinement.reason === 'traversal'
            ? 'path traversal ("..") is not allowed'
            : 'path resolves outside the repository root'
      console.log(chalk.red(`Cannot open "${item.filePath}": ${reasonMsg}.`))
      return
    }

    const editorEnv = process.env.EDITOR || 'code'
    // $EDITOR commonly includes flags (`code -w`, `vim -f`). Tokenize on
    // whitespace so the leading word is the executable and the rest are
    // args — execFile takes the executable and args separately, no shell.
    const editorParts = editorEnv.trim().split(/\s+/).filter(Boolean)
    const editor = editorParts[0] || 'code'
    const editorArgs = [...editorParts.slice(1), confinement.absPath]
    try {
      await execFileAsync(editor, editorArgs)
    } catch (err) {
      console.log(chalk.red(`Failed to open ${item.filePath} in ${editor}: ${(err as Error).message}`))
    }
  }

  private markAsComplete() {
    this.items[this.currentIndex].status = 'completed'
    this.navigate(1)
  }

  private async autoFix(): Promise<void> {
    if (!this.config?.autoFixTool) {
      console.log(chalk.yellow('No autoFixTool configured. Set "autoFixTool" in .coco.config.json'))
      return
    }
    const item = this.items[this.currentIndex]
    console.clear()
    console.log(chalk.bold.cyan(`🤖 Auto-fix: ${item.title}`))
    console.log(chalk.dim(`File: ${item.filePath}`))

    // Release raw mode so @inquirer/prompts (used for the confirm prompt below)
    // and, once confirmed, the child process can both manage stdin themselves.
    process.stdin.setRawMode(false)
    process.stdin.pause()

    try {
      const prepared = await prepareAutoFix(item, this.config, this.repoRoot)
      if (!prepared) return

      // Show the exact command before running it — previously only the
      // finding's title and file path were printed, with no way to see
      // which flags the spawned CLI would receive (#1840).
      console.log(chalk.dim(`\nCommand: ${prepared.binary} ${prepared.args.join(' ')} <prompt>\n`))

      const confirmed = await confirmPrompt({
        message: `Run "${prepared.binary}" with the flags above? It can edit files in your working tree.`,
        default: false,
      })
      if (!confirmed) {
        console.log(chalk.yellow('Auto-fix cancelled.'))
        await new Promise((r) => setTimeout(r, 900))
        return
      }

      // Fully release terminal control before handing off to the child process.
      await new Promise((r) => setTimeout(r, 50))
      await prepared.execute()
      this.markAsComplete()
      console.log(chalk.green('\n✅ Auto-fix completed successfully.'))
      await new Promise((r) => setTimeout(r, 1200))
    } catch (err) {
      console.log(chalk.red(`\n❌ Auto-fix failed: ${(err as Error).message}`))
      await new Promise((r) => setTimeout(r, 1800))
    } finally {
      // Restore terminal for our keypress handler
      process.stdin.resume()
      process.stdin.setRawMode(true)
    }
  }

  private async fileIssue(): Promise<void> {
    if (!this.git) {
      console.log(chalk.yellow('No repository context available for filing an issue.'))
      return
    }

    const item = this.items[this.currentIndex]
    const { title, body } = findingToIssue(item)

    // Release raw mode so @inquirer/prompts (used for the confirm prompt) can
    // manage stdin itself, same as autoFix() handing off to a child process.
    process.stdin.setRawMode(false)
    process.stdin.pause()

    try {
      const overview = await getProviderOverview(this.git)
      const provider = overview.repository.provider

      if (provider !== 'github' && provider !== 'gitlab' && provider !== 'bitbucket' && provider !== 'gitea') {
        console.log(
          chalk.yellow(
            overview.repository.message || 'No supported remote (GitHub, GitLab, Bitbucket, or Gitea) detected.'
          )
        )
        return
      }

      if (!overview.authenticated) {
        console.log(chalk.yellow(overview.message || 'The forge CLI is unavailable.'))
        return
      }

      console.log(chalk.bold('\nTitle:'))
      console.log(title)
      console.log(chalk.bold('\nBody:'))
      console.log(body || chalk.dim('(empty)'))
      console.log('')

      const confirmed = await confirmPrompt({ message: 'File this as an issue?', default: true })
      if (!confirmed) {
        console.log(chalk.yellow('Issue creation cancelled.'))
        return
      }

      const repoPath =
        overview.repository.owner && overview.repository.name
          ? `${overview.repository.owner}/${overview.repository.name}`
          : undefined
      const forge = getForgeActions(provider, {
        gitlabPath: repoPath,
        gitlabHost: overview.repository.host,
        bitbucketPath: repoPath,
        giteaPath: repoPath,
        giteaHost: overview.repository.host,
      })

      const result = await forge.createIssue({ title, body })
      if (!result.ok) {
        console.log(chalk.red(result.message))
        return
      }

      console.log(chalk.green(result.message))
      this.markAsComplete()
      await new Promise((r) => setTimeout(r, 1200))
    } catch (err) {
      console.log(chalk.red(`Failed to file issue: ${(err as Error).message}`))
      await new Promise((r) => setTimeout(r, 1800))
    } finally {
      process.stdin.resume()
      process.stdin.setRawMode(true)
    }
  }

  private skip() {
    this.items[this.currentIndex].status = 'skipped'
    this.navigate(1)
  }

  private omit() {
    this.items[this.currentIndex].status = 'omitted'
    this.navigate(1)
  }

  private navigate(direction: number) {
    const allDone = this.items.every((item) => item.status !== 'pending')
    if (allDone) return

    let next = (this.currentIndex + direction + this.items.length) % this.items.length
    while (this.items[next].status !== 'pending') {
      next = (next + direction + this.items.length) % this.items.length
    }
    this.currentIndex = next
  }

  public async start() {
    while (true) {
      await this.displayCurrentItem()
      const action = await this.getActionWithKeyboardShortcut()

      switch (action) {
        case 'open':
          await this.openFile()
          break
        case 'complete':
          this.markAsComplete()
          break
        case 'autofix':
          await this.autoFix()
          break
        case 'fileIssue':
          await this.fileIssue()
          break
        case 'skip':
          this.skip()
          break
        case 'omit':
          this.omit()
          break
        case 'next':
          this.navigate(1)
          break
        case 'prev':
          this.navigate(-1)
          break
        case 'exit':
          this.rl.close()
          await this.displaySummary()
          return
      }

      if (this.items.every((item) => item.status !== 'pending')) {
        this.rl.close()
        await this.displaySummary()
        return
      }
    }
  }

  private renderMenu() {
    const choices = this.getChoices()
    console.log(chalk.dim('Choose an action:'))
    choices.forEach((c) => console.log(`  ${c.name}`))
  }

  private getActionWithKeyboardShortcut(): Promise<string> {
    this.renderMenu()
    return new Promise((resolve) => {
      const actionMap: Record<string, string> = {
        o: 'open',
        a: 'autofix',
        i: 'fileIssue',
        d: 'complete',
        s: 'skip',
        x: 'omit',
        right: 'next',
        left: 'prev',
        q: 'exit',
      }

      const handleKeypress = (_: string, key: { name: string; ctrl?: boolean }) => {
        if (key?.ctrl && key.name === 'c') {
          process.stdin.removeListener('keypress', handleKeypress)
          resolve('exit')
          return
        }

        const action = key ? actionMap[key.name] : undefined
        if (!action) return

        process.stdin.removeListener('keypress', handleKeypress)
        resolve(action)
      }

      process.stdin.on('keypress', handleKeypress)
    })
  }

  private async displaySummary() {
    console.log(chalk.bold('Review Summary:\n'))

    const statusCounts = {
      completed: 0,
      skipped: 0,
      omitted: 0,
      pending: 0,
    }

    this.items.forEach((item, index) => {
      statusCounts[item.status as keyof typeof statusCounts]++
      console.log(
        chalk.dim(`${index + 1}.`),
        this.getStatusColor(item.status)(item.status.toUpperCase()),
        chalk.dim('-'),
        item.summary
      )
    })

    console.log('\nStatus Counts:')
    Object.entries(statusCounts).forEach(([status, count]) => {
      console.log(this.getStatusColor(status as keyof typeof statusCounts)(`${status}: ${count}`))
    })
  }

  private getStatusColor(status: string) {
    switch (status) {
      case 'completed':
        return chalk.green
      case 'skipped':
        return chalk.yellow
      case 'omitted':
        return chalk.red
      default:
        return chalk.blue
    }
  }
}
