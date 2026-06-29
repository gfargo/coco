# Design Document: review-autofix-agent

## Overview

This feature extends `coco review` with an auto-fix action that spawns a configured AI CLI tool
(e.g. `codex`, `claude`, `gemini`) as a child process directly in the user's terminal. The child
process receives a rich prompt built from the selected `ReviewFeedbackItem` and the contents of the
affected file, and its output streams live so the user can watch the agent work in real time.

The design is built around three concerns:

1. **Adapter pattern** — a `BaseAdapter` interface decouples the spawning logic from the rest of
   the system, so new tools can be added by dropping in a new file.
2. **Prompt construction** — a dedicated `buildPrompt` function assembles a structured, context-rich
   prompt from the feedback item and file contents.
3. **UI integration** — `TaskList` gains a single new action (`autofix`, hotkey `a`) that delegates
   entirely to the `runAutoFix` entry point.

---

## Module Structure

```
src/lib/autofix/
  index.ts              # runAutoFix entry point + adapter registry
  types.ts              # BaseAdapter interface, AutoFixConfig type
  buildPrompt.ts        # prompt construction from ReviewFeedbackItem + file
  adapters/
    codex.ts            # CodexAdapter
    claude.ts           # ClaudeAdapter (optional)
    gemini.ts           # GeminiAdapter (optional)
```

Modifications to existing files:

- `src/lib/config/types.ts` — add `autoFixTool` and `autoFixToolOptions` to `BaseConfig`
- `src/lib/ui/TaskList.ts` — add `autofix` action, hotkey, and `autoFix()` method

---

## Data Models

### Config additions (`src/lib/config/types.ts`)

```typescript
type BaseConfig = {
  // ...existing fields...

  /**
   * The AI CLI tool to use for auto-fixing review issues.
   * Must match a registered adapter key (e.g. "codex", "claude", "gemini").
   * When unset, the auto-fix action is disabled.
   */
  autoFixTool?: string

  /**
   * Additional key-value flags passed to the auto-fix CLI tool.
   * Keys are flag names (without leading dashes); values are flag values.
   * @example { "model": "o4-mini", "approval-mode": "auto-edit" }
   */
  autoFixToolOptions?: Record<string, string>
}
```

### `BaseAdapter` interface (`src/lib/autofix/types.ts`)

```typescript
export interface BaseAdapter {
  /**
   * Spawn the AI CLI tool with the given prompt and options.
   * Must use spawn with stdio: 'inherit' so output streams to the terminal.
   * Resolves when the child process exits with code 0.
   * Rejects with an error containing the exit code on non-zero exit.
   */
  run(prompt: string, options?: Record<string, string>): Promise<void>
}

export type AutoFixConfig = {
  autoFixTool?: string
  autoFixToolOptions?: Record<string, string>
}
```

---

## Component Design

### `buildPrompt` (`src/lib/autofix/buildPrompt.ts`)

Accepts a `ReviewFeedbackItem` and returns a formatted prompt string. Reads the file at
`item.filePath` using `fs.promises.readFile`. If the file is not found, substitutes a warning note.

Prompt structure:

```
You are an expert software engineer. Fix the following code review issue.

## Issue
Title:    <title>
Category: <category>
Severity: <severity>/10
File:     <filePath>

## Problem
<summary>

## File Contents
```<extension>
<file contents>
```

Fix the issue described above. Make only the changes necessary to resolve this specific problem.
```

If the file is not found:

```
## File Contents
[WARNING: File "<filePath>" was not found on disk. Fix based on the issue description alone.]
```

Signature:

```typescript
export async function buildPrompt(item: ReviewFeedbackItem): Promise<string>
```

---

### `CodexAdapter` (`src/lib/autofix/adapters/codex.ts`)

Spawns the `codex` binary using Node's `child_process.spawn` with `stdio: 'inherit'`. The prompt
is passed as the first positional argument. Each entry in `autoFixToolOptions` is appended as
`--key value` flags before the prompt.

```typescript
export class CodexAdapter implements BaseAdapter {
  async run(prompt: string, options?: Record<string, string>): Promise<void>
}
```

Invocation shape:

```
codex [--key value ...] "<prompt>"
```

Error handling:
- `ENOENT` on spawn → throw `Error('codex binary not found. Please install it: npm i -g @openai/codex')`
- Non-zero exit code → throw `Error('codex exited with code <code>')`

---

### `ClaudeAdapter` (`src/lib/autofix/adapters/claude.ts`) — optional

Spawns the `claude` binary. Claude Code CLI accepts a prompt via the `-p` / `--print` flag for
non-interactive execution.

Invocation shape:

```
claude --print [--key value ...] "<prompt>"
```

---

### `GeminiAdapter` (`src/lib/autofix/adapters/gemini.ts`) — optional

Spawns the `gemini` binary. Gemini CLI accepts a prompt as a positional argument.

Invocation shape:

```
gemini [--key value ...] "<prompt>"
```

---

### Adapter Registry + `runAutoFix` (`src/lib/autofix/index.ts`)

```typescript
const registry: Record<string, BaseAdapter> = {
  codex: new CodexAdapter(),
  // claude: new ClaudeAdapter(),  // added when optional task 9 is implemented
  // gemini: new GeminiAdapter(),  // added when optional task 10 is implemented
}

export async function runAutoFix(
  item: ReviewFeedbackItem,
  config: AutoFixConfig
): Promise<void>
```

Logic:

1. If `config.autoFixTool` is unset → return (no-op)
2. Look up adapter in registry; if not found → throw `Error('Unknown autoFixTool: "<value>"')`
3. Call `buildPrompt(item)` to construct the prompt string
4. Call `adapter.run(prompt, config.autoFixToolOptions)`

---

### `TaskList` modifications (`src/lib/ui/TaskList.ts`)

`TaskList` needs access to the config to know whether `autoFixTool` is set. The constructor
signature is extended to accept an optional config:

```typescript
constructor(items: ReviewFeedbackItem[], config?: AutoFixConfig)
```

Changes to `getChoices()`:

```typescript
{ name: `🤖 Auto-fix ${hotKey('a')}`, value: 'autofix' },
```

Changes to `getActionWithKeyboardShortcut()` — add case:

```typescript
case 'a':
  resolve('autofix')
  break
```

New `autoFix()` method:

```typescript
private async autoFix(): Promise<void> {
  if (!this.config?.autoFixTool) {
    console.log(chalk.yellow('No autoFixTool configured. Set "autoFixTool" in .coco.config.json'))
    return
  }
  try {
    await runAutoFix(this.items[this.currentIndex], this.config)
    this.markAsComplete()
  } catch (err) {
    console.log(chalk.red(`Auto-fix failed: ${(err as Error).message}`))
  }
}
```

Case added to the `start()` switch:

```typescript
case 'autofix':
  await this.autoFix()
  break
```

---

## Sequence: Auto-fix triggered by user

```
User presses 'a' in TaskList
  → TaskList.autoFix()
    → checks config.autoFixTool (if unset: print message, return)
    → runAutoFix(currentItem, config)
      → buildPrompt(item)          reads file from disk
      → registry[autoFixTool].run(prompt, options)
        → spawn('codex', [...flags, prompt], { stdio: 'inherit', env: process.env })
          → child process output streams live to terminal
          → process exits
            → exit 0  → resolve → markAsComplete() + navigate(1)
            → exit !0 → reject  → print error, stay on item
```

---

## Error States

| Condition | Behaviour |
|---|---|
| `autoFixTool` not set | Silent no-op with yellow info message |
| `autoFixTool` set to unknown value | Red error message, stay on item |
| Binary not on PATH (`ENOENT`) | Red error with install instructions, stay on item |
| Child process exits non-zero | Red error with exit code, stay on item |
| File not found on disk | Warning included in prompt; fix proceeds without file contents |

---

## Configuration Example

```json
{
  "autoFixTool": "codex",
  "autoFixToolOptions": {
    "model": "o4-mini",
    "approval-mode": "auto-edit"
  }
}
```

---

## Testing Strategy

Each module is unit-tested in a co-located `.test.ts` file with all I/O mocked:

- `buildPrompt.test.ts` — mocks `fs.promises.readFile`; asserts prompt structure for file-found and file-not-found paths
- `adapters/codex.test.ts` — mocks `child_process.spawn`; asserts binary name, arg order, flag appending, exit code handling, ENOENT handling
- `index.test.ts` — mocks `buildPrompt` and adapter `run`; asserts registry lookup, no-op on unset tool, error on unknown tool
- `TaskList.test.ts` — mocks `runAutoFix`; asserts choice presence, keypress mapping, success/error/unconfigured paths
