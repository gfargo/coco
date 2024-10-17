import chalk from 'chalk'
import inquirer from 'inquirer'
import * as readline from 'readline'
import { ReviewFeedbackItem } from '../../commands/review/handler'
import { execPromise } from '../utils/execPromise'
import { bannerWithHeader, DIVIDER, hotKey, severityColor, statusColor } from './helpers'

type FeedbackTaskItem = ReviewFeedbackItem & {
  status: 'pending' | 'completed' | 'skipped' | 'omitted'
}

export class TaskList {
  private items: FeedbackTaskItem[]
  private currentIndex: number = 0
  private rl: readline.Interface

  constructor(items: ReviewFeedbackItem[]) {
    this.items = items.map((item) => ({ ...item, status: 'pending' }))
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })
    process.stdin.setRawMode(true)
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
      { name: `⏩ Skip ${hotKey('s')}`, value: 'skip' },
      { name: `🙈 Omit ${hotKey('x')}`, value: 'omit' },
      { name: `${exitText} ${hotKey('q')}`, value: 'exit' },
    ]
  }

  private async promptAction() {
    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'Choose an action:',
        choices: this.getChoices(),
      },
    ])
    return action
  }

  private async openFile() {
    const item = this.items[this.currentIndex]
    await execPromise(`${process.env.EDITOR || 'code'} ${item.filePath}`)
  }

  private markAsComplete() {
    this.items[this.currentIndex].status = 'completed'
    this.navigate(1)
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
    this.currentIndex = (this.currentIndex + direction + this.items.length) % this.items.length
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
    }
  }

  private getActionWithKeyboardShortcut(): Promise<string> {
    return new Promise((resolve) => {
      interface Key {
        name: string
      }

      const keyHandler = (_: string, key: Key) => {
        if (key) {
          switch (key.name) {
        case 'o':
          resolve('open')
          break
        case 'd':
          resolve('complete')
          break
        case 's':
          resolve('skip')
          break
        case 'x':
          resolve('omit')
          break
        case 'right':
          resolve('next')
          break
        case 'left':
          resolve('prev')
          break
        case 'q':
          resolve('exit')
          break
          }
        }
      }

      readline.emitKeypressEvents(process.stdin)
      process.stdin.on('keypress', keyHandler)
      this.promptAction().then((action) => {
        process.stdin.removeListener('keypress', keyHandler)
         resolve(action)
      })
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
