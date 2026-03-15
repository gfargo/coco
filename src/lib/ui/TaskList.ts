import chalk from 'chalk'
import * as readline from 'readline'
import { ReviewFeedbackItem } from '../../commands/review/config'
import { runAutoFix } from '../autofix'
import { AutoFixConfig } from '../autofix/types'
import { execPromise } from '../utils/execPromise'
import { bannerWithHeader, DIVIDER, hotKey, severityColor, statusColor } from './helpers'

type FeedbackTaskItem = ReviewFeedbackItem & {
  status: 'pending' | 'completed' | 'skipped' | 'omitted'
}

export class TaskList {
  private items: FeedbackTaskItem[]
  private currentIndex: number = 0
  private rl: readline.Interface
  private config?: AutoFixConfig

  constructor(items: ReviewFeedbackItem[], config?: AutoFixConfig) {
    this.items = items.map((item) => ({ ...item, status: 'pending' }))
    this.config = config
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
      { name: `⏩ Skip ${hotKey('s')}`, value: 'skip' },
      { name: `🙈 Omit ${hotKey('x')}`, value: 'omit' },
      { name: `${exitText} ${hotKey('q')}`, value: 'exit' },
    ]
  }

  private async openFile() {
    const item = this.items[this.currentIndex]
    await execPromise(`${process.env.EDITOR || 'code'} ${item.filePath}`)
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
    console.log(chalk.bold.cyan(`🤖 Running auto-fix: ${item.title}`))
    console.log(chalk.dim(`File: ${item.filePath}\n`))

    // Fully release terminal control before handing off to child process
    process.stdin.setRawMode(false)
    process.stdin.pause()
    await new Promise((r) => setTimeout(r, 50))

    try {
      await runAutoFix(item, this.config)
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
        d: 'complete',
        s: 'skip',
        x: 'omit',
        right: 'next',
        left: 'prev',
        q: 'exit',
      }

      const handleKeypress = (_: string, key: { name: string }) => {
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
