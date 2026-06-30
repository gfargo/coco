# Requirements Document

## Introduction

The `review-autofix-agent` feature extends the `coco review` command to allow users to trigger an
AI CLI sub-agent (e.g. `codex`, `claude`, `gemini`) to automatically fix issues surfaced during a
code review session. After the review generates a list of `ReviewFeedbackItem` objects and displays
them in the interactive `TaskList` UI, the user can select a feedback item and press a hotkey to
spawn the configured AI CLI tool as a child process. The child process receives a rich prompt
constructed from the feedback item and relevant file context, and its output is streamed live to the
terminal so the user can observe progress in real time.

## Glossary

- **AutoFix_Agent**: The new module (`src/lib/autofix/`) responsible for spawning and managing the
  child AI CLI process.
- **Adapter**: A concrete implementation of the `BaseAdapter` interface for a specific AI CLI tool
  (e.g. `CodexAdapter`).
- **BaseAdapter**: The abstract interface that all AI CLI tool adapters must implement.
- **Child_Process**: The spawned OS-level process running the configured AI CLI tool.
- **ReviewFeedbackItem**: An existing structured object containing `title`, `summary`, `severity`,
  `category`, and `filePath` fields produced by the `coco review` command.
- **TaskList**: The existing interactive terminal UI class (`src/lib/ui/TaskList.ts`) that presents
  `ReviewFeedbackItem` objects to the user.
- **AutoFix_Prompt**: The constructed text prompt passed to the Child_Process, built from a
  `ReviewFeedbackItem` and relevant file content.
- **autoFixTool**: A new configuration option specifying which AI CLI tool adapter to use.
- **autoFixToolOptions**: A new configuration option containing tool-specific arguments passed to
  the Child_Process.
- **Config**: The existing coco configuration system loaded via `loadConfig`.

---

## Requirements

### Requirement 1: Adapter Interface

**User Story:** As a developer maintaining coco, I want a stable adapter interface for AI CLI
tools, so that new tools can be added without modifying existing code.

#### Acceptance Criteria

1. THE AutoFix_Agent SHALL define a `BaseAdapter` interface with a method that accepts an
   `AutoFix_Prompt` string and `autoFixToolOptions` and returns a promise that resolves when the
   Child_Process exits.
2. THE AutoFix_Agent SHALL export a `CodexAdapter` that implements `BaseAdapter` using the `codex`
   CLI binary.
3. WHEN a new adapter is registered, THE AutoFix_Agent SHALL invoke it using only the `BaseAdapter`
   interface, without requiring changes to `TaskList` or the review handler.

---

### Requirement 2: Prompt Construction

**User Story:** As a user, I want the AI sub-agent to receive full context about the issue it must
fix, so that it can make accurate and targeted code changes.

#### Acceptance Criteria

1. WHEN an auto-fix is triggered for a `ReviewFeedbackItem`, THE AutoFix_Agent SHALL construct an
   `AutoFix_Prompt` that includes the item's `title`, `summary`, `severity`, `category`, and
   `filePath`.
2. WHEN the `filePath` in the `ReviewFeedbackItem` refers to a file that exists on disk, THE
   AutoFix_Agent SHALL read the file contents and include them in the `AutoFix_Prompt`.
3. IF the `filePath` in the `ReviewFeedbackItem` refers to a file that does not exist on disk, THEN
   THE AutoFix_Agent SHALL construct the `AutoFix_Prompt` without file contents and SHALL include a
   warning note in the prompt indicating the file was not found.
4. THE AutoFix_Agent SHALL format the `AutoFix_Prompt` as a single string with clearly delimited
   sections for issue metadata and file content.

---

### Requirement 3: Child Process Spawning and Output Streaming

**User Story:** As a user, I want to watch the AI sub-agent work in real time, so that I can
monitor progress and intervene if needed.

#### Acceptance Criteria

1. WHEN an auto-fix action is triggered, THE AutoFix_Agent SHALL spawn the Child_Process using the
   configured adapter with the constructed `AutoFix_Prompt`.
2. WHILE the Child_Process is running, THE AutoFix_Agent SHALL pipe the Child_Process stdout and
   stderr streams directly to the current process stdout and stderr respectively.
3. WHEN the Child_Process exits with a zero exit code, THE AutoFix_Agent SHALL resolve the
   operation as successful.
4. IF the Child_Process exits with a non-zero exit code, THEN THE AutoFix_Agent SHALL reject with
   an error that includes the exit code.
5. IF the configured AI CLI binary is not found on the system PATH, THEN THE AutoFix_Agent SHALL
   throw an error with a message indicating the binary name and that it must be installed.

---

### Requirement 4: TaskList UI Integration

**User Story:** As a user reviewing code, I want an "Auto-fix" action available in the review UI,
so that I can trigger automated fixes without leaving the review session.

#### Acceptance Criteria

1. THE TaskList SHALL include a `🤖 Auto-fix` choice in the action menu rendered by `getChoices()`.
2. THE TaskList SHALL map the keyboard key `a` to the `autofix` action in the keypress handler.
3. WHEN the `autofix` action is selected and no `autoFixTool` is configured, THE TaskList SHALL
   display a message informing the user that no auto-fix tool is configured and SHALL return to the
   action menu without spawning a process.
4. WHEN the `autofix` action is selected and an `autoFixTool` is configured, THE TaskList SHALL
   invoke the AutoFix_Agent with the current `ReviewFeedbackItem`.
5. WHEN the AutoFix_Agent completes successfully, THE TaskList SHALL mark the current item's status
   as `completed` and SHALL advance to the next item.
6. IF the AutoFix_Agent throws an error, THEN THE TaskList SHALL display the error message to the
   user and SHALL return to the action menu without changing the item's status.

---

### Requirement 5: Configuration

**User Story:** As a user, I want to configure which AI CLI tool is used for auto-fixing, so that I
can use the tool that fits my workflow.

#### Acceptance Criteria

1. THE Config SHALL accept an optional `autoFixTool` string field that specifies the adapter to use
   (e.g. `"codex"`).
2. THE Config SHALL accept an optional `autoFixToolOptions` record field that contains key-value
   pairs passed as additional arguments to the Child_Process.
3. WHEN `autoFixTool` is not set, THE AutoFix_Agent SHALL treat auto-fix as disabled and SHALL NOT
   spawn any Child_Process.
4. WHEN `autoFixTool` is set to a value for which no adapter is registered, THE AutoFix_Agent SHALL
   throw an error identifying the unrecognized tool name.

---

### Requirement 6: CodexAdapter Implementation

**User Story:** As a user with `codex` installed, I want coco to use it as the default auto-fix
tool, so that I can immediately benefit from the feature without additional setup.

#### Acceptance Criteria

1. THE CodexAdapter SHALL invoke the `codex` binary as a Child_Process with the `AutoFix_Prompt`
   passed as a command-line argument.
2. WHEN `autoFixToolOptions` contains recognized `codex` flags, THE CodexAdapter SHALL append them
   to the `codex` invocation.
3. THE CodexAdapter SHALL inherit the current process environment variables when spawning the
   Child_Process, so that API keys and shell configuration are available to `codex`.
