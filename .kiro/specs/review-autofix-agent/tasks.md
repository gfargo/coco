# Implementation Plan: review-autofix-agent

## Overview

Extend `coco review` with an auto-fix action that spawns a configured AI CLI tool (e.g. `codex`) as a child process, passing a rich prompt built from the selected `ReviewFeedbackItem` and its file contents. Output streams live to the terminal.

## Tasks

- [x] 1. Add config fields to `BaseConfig`
  - Add optional `autoFixTool?: string` and `autoFixToolOptions?: Record<string, string>` to `BaseConfig` in `src/lib/config/types.ts`
  - _Requirements: 5.1, 5.2_

- [x] 2. Define `BaseAdapter` interface and `AutoFixConfig` type
  - [x] 2.1 Create `src/lib/autofix/types.ts`
    - Define `BaseAdapter` interface with `run(prompt: string, options?: Record<string, string>): Promise<void>`
    - Define `AutoFixConfig` type referencing the new config fields
    - _Requirements: 1.1_

- [x] 3. Implement prompt construction
  - [x] 3.1 Create `src/lib/autofix/buildPrompt.ts`
    - Accept a `ReviewFeedbackItem` and return a formatted `AutoFix_Prompt` string
    - Read file contents from disk using `fs.readFile`; include them in a clearly delimited section
    - If file not found, include a warning note instead of file contents
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 3.2 Write unit tests for `buildPrompt` in `src/lib/autofix/buildPrompt.test.ts`
    - Mock `fs.readFile`; test prompt includes all `ReviewFeedbackItem` fields
    - Test file-found path includes file contents
    - Test file-not-found path includes warning note
    - _Requirements: 2.1, 2.2, 2.3_

- [x] 4. Implement `CodexAdapter`
  - [x] 4.1 Create `src/lib/autofix/adapters/codex.ts`
    - Implement `BaseAdapter`; spawn `codex` binary via `spawn` with `stdio: 'inherit'`
    - Pass the prompt as a CLI argument; append any `autoFixToolOptions` as flags
    - Inherit current process env
    - Resolve on exit code 0; reject with exit code on non-zero
    - Throw descriptive error if binary not found on PATH (`ENOENT`)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 6.1, 6.2, 6.3_

  - [x] 4.2 Write unit tests for `CodexAdapter` in `src/lib/autofix/adapters/codex.test.ts`
    - Mock `child_process.spawn`
    - Test correct binary and args are passed
    - Test `autoFixToolOptions` flags are appended
    - Test resolves on exit code 0
    - Test rejects with exit code on non-zero exit
    - Test throws descriptive error on `ENOENT`
    - _Requirements: 3.3, 3.4, 3.5, 6.1, 6.2_

- [x] 5. Implement adapter registry and `runAutoFix` entry point
  - [x] 5.1 Create `src/lib/autofix/index.ts`
    - Define adapter registry map `{ codex: CodexAdapter }`
    - Export `runAutoFix(item: ReviewFeedbackItem, config: BaseConfig): Promise<void>`
      - Return early (no-op) if `autoFixTool` is unset
      - Throw on unrecognized `autoFixTool`
      - Build prompt via `buildPrompt`, then invoke the adapter's `run` method
    - _Requirements: 1.3, 5.3, 5.4_

  - [x] 5.2 Write unit tests for `runAutoFix` in `src/lib/autofix/index.test.ts`
    - Mock `buildPrompt` and adapter `run` method
    - Test no-op when `autoFixTool` is unset
    - Test throws on unrecognized `autoFixTool` value
    - Test correct adapter is resolved and `run` is called with the built prompt
    - _Requirements: 1.3, 5.3, 5.4_

- [x] 6. Checkpoint — ensure unit tests pass
  - Run `npm run test:jest` and confirm all new tests pass; resolve any issues before continuing.

- [x] 7. Integrate auto-fix action into `TaskList`
  - [x] 7.1 Modify `src/lib/ui/TaskList.ts`
    - Add `🤖 Auto-fix` choice to `getChoices()` with keyboard shortcut `a`
    - Add `autoFix()` method that calls `runAutoFix` with the current item and config
    - If `autoFixTool` is not configured, display a message and return to the action menu
    - On success, mark item status as `completed` and advance to next item
    - On error, display the error message and return to the action menu without changing status
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [x] 7.2 Write unit tests for `TaskList` auto-fix integration in `src/lib/ui/TaskList.test.ts`
    - Mock `runAutoFix`
    - Test `autofix` action is present in choices
    - Test keypress `a` resolves to `autofix` action
    - Test displays message and stays on item when `autoFixTool` is not configured
    - Test marks item `completed` and advances on successful `runAutoFix`
    - Test displays error and stays on item when `runAutoFix` throws
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

- [x] 8. Wire config into `TaskList` instantiation in the review handler
  - Modify `src/commands/review/handler.ts` to pass `config` as the second argument to `new TaskList(recap, config)`
  - This enables `TaskList.autoFix()` to read `autoFixTool` and `autoFixToolOptions` at runtime
  - _Requirements: 4.3, 4.4, 5.1, 5.2_

- [x] 9. Regenerate `schema.json` to include new config fields
  - Run `npm run build:schema` after the config type changes in task 1 are complete
  - Verify `schema.json` contains `autoFixTool` and `autoFixToolOptions` entries
  - _Requirements: 5.1, 5.2_

- [x] 10. Final checkpoint — ensure all tests pass
  - Run `npm run test:jest` and confirm everything passes; ask the user if any questions arise.

- [ ]* 11. Implement `ClaudeAdapter` for Claude Code CLI
  - [ ]* 11.1 Create `src/lib/autofix/adapters/claude.ts`
    - Implement `BaseAdapter`; spawn `claude` binary via `spawn` with `stdio: 'inherit'`
    - Pass the prompt using Claude Code's CLI argument convention (e.g. `--print` flag for non-interactive mode)
    - Append any `autoFixToolOptions` as flags; inherit current process env
    - Resolve on exit code 0; reject with exit code on non-zero; throw descriptive error on `ENOENT`
    - _Requirements: 1.1, 1.2, 1.3_

  - [ ]* 11.2 Register `ClaudeAdapter` in the adapter registry in `src/lib/autofix/index.ts`
    - Add `claude` key to the registry map pointing to `ClaudeAdapter`
    - _Requirements: 1.3_

  - [ ]* 11.3 Write unit tests for `ClaudeAdapter` in `src/lib/autofix/adapters/claude.test.ts`
    - Mirror the `CodexAdapter` test structure
    - Test correct binary, args, and flag conventions for Claude Code CLI
    - _Requirements: 1.1, 3.3, 3.4, 3.5_

- [ ]* 12. Implement `GeminiAdapter` for Gemini CLI
  - [ ]* 12.1 Create `src/lib/autofix/adapters/gemini.ts`
    - Implement `BaseAdapter`; spawn `gemini` binary via `spawn` with `stdio: 'inherit'`
    - Pass the prompt using Gemini CLI's argument convention
    - Append any `autoFixToolOptions` as flags; inherit current process env
    - Resolve on exit code 0; reject with exit code on non-zero; throw descriptive error on `ENOENT`
    - _Requirements: 1.1, 1.2, 1.3_

  - [ ]* 12.2 Register `GeminiAdapter` in the adapter registry in `src/lib/autofix/index.ts`
    - Add `gemini` key to the registry map pointing to `GeminiAdapter`
    - _Requirements: 1.3_

  - [ ]* 12.3 Write unit tests for `GeminiAdapter` in `src/lib/autofix/adapters/gemini.test.ts`
    - Mirror the `CodexAdapter` test structure
    - Test correct binary, args, and flag conventions for Gemini CLI
    - _Requirements: 1.1, 3.3, 3.4, 3.5_

## Notes

- Tasks marked with `*` are optional — tasks 11 and 12 extend the adapter registry with Claude and Gemini support after the core Codex implementation is stable
- `spawn` with `stdio: 'inherit'` is required — do not use `exec`
- No `schema.json` changes are needed in these tasks; run `npm run build:schema` separately after config types are updated
- Adapter registry is a simple object literal — no dynamic loading needed
- Each adapter follows the same pattern; use `CodexAdapter` as the reference implementation
