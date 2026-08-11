# Requirements Document

## Introduction

This feature adds branch write operations to the coco workstation TUI (`coco ui`) that are currently missing from the branches view: merge, reset-branch-to-ref, push (including force-push), pull-with-strategy-choice, fast-forward merge, and a sync-branch compound operation. These operations complete the branch synchronization story, making `coco ui` a self-sufficient terminal git client for everyday branch workflows without dropping to a shell.

## Glossary

- **Workstation**: The full-screen Ink/React TUI accessed via `coco ui` or `coco log -i`
- **Branches_View**: The workstation surface reached via `g b` that lists local and remote branches
- **Cursored_Branch**: The branch currently highlighted by the selection cursor in the Branches_View
- **Current_Branch**: The branch checked out in the working directory (HEAD)
- **Merge_Operation**: A git merge that integrates changes from one branch into another
- **Fast_Forward_Merge**: A merge where the target branch pointer advances without creating a merge commit because no divergence exists
- **Reset_To_Ref**: Moves the current branch pointer to match another ref (branch, tag, or commit) using soft, mixed, or hard mode
- **Force_Push**: A push that overwrites remote history using `--force-with-lease` (refuses to clobber unseen remote commits)
- **Sync_Operation**: A compound pull-then-push workflow that brings local up to date and then publishes local commits
- **Undo_Stack**: The session-scoped in-memory stack that records invertible destructive actions (branch delete, stash drop, reset, tag delete)
- **Confirmation_Overlay**: The y-confirm or enter-confirm panel that gates destructive bare-keystroke actions
- **Momentum_Hint**: A success message that names the next logical keystroke (e.g. "Merged main → feature. Push with P")
- **Command_Palette**: The `:` overlay listing all registered workflows by name, searchable by typing
- **Footer_Hints**: The bottom-row key labels showing available actions for the current view
- **Conflicts_View**: The workstation surface (`g x`) that handles conflict resolution when a merge or rebase produces conflicts

## Requirements

### Requirement 1: Merge Branch

**User Story:** As a developer, I want to merge the cursored branch into my current branch from the branches view, so that I can integrate changes without leaving the TUI.

#### Acceptance Criteria

1. WHEN the user presses the merge keybinding on a Cursored_Branch in the Branches_View, THE Workstation SHALL initiate a Merge_Operation that merges the Cursored_Branch into the Current_Branch
2. WHEN the Cursored_Branch is the same as the Current_Branch, THE Workstation SHALL prevent the merge from initiating and display an error message stating that a branch cannot be merged into itself
3. WHEN the Merge_Operation completes without conflicts, THE Workstation SHALL display a success Momentum_Hint naming the merged branch, the target branch, and suggesting push as the next action
4. WHEN the Merge_Operation produces conflicts, THE Workstation SHALL transition to the Conflicts_View and display a status message indicating the number of conflicted files
5. WHEN the Merge_Operation is initiated, THE Workstation SHALL display a Confirmation_Overlay showing the source branch, the target branch, and the merge direction

### Requirement 2: Fast-Forward Merge

**User Story:** As a developer, I want the workstation to detect when a fast-forward merge is possible and offer it as the default strategy, so that I avoid unnecessary merge commits.

#### Acceptance Criteria

1. WHEN the Current_Branch is strictly behind the Cursored_Branch with no divergent commits, THE Workstation SHALL indicate in the Confirmation_Overlay that a fast-forward merge is available
2. WHEN a fast-forward merge is available and the user confirms, THE Workstation SHALL advance the Current_Branch pointer without creating a merge commit
3. WHEN the branches have diverged, THE Workstation SHALL perform a standard merge that creates a merge commit
4. WHEN a Fast_Forward_Merge completes, THE Workstation SHALL display a success message stating the branch was fast-forwarded and suggesting push as the next action

### Requirement 3: Reset Current Branch to Another Ref

**User Story:** As a developer, I want to reset my current branch to match the cursored branch from the branches view, so that I can realign branch pointers without using the command line.

#### Acceptance Criteria

1. WHEN the user presses the reset keybinding on a Cursored_Branch in the Branches_View, THE Workstation SHALL present a mode-choice prompt offering soft, mixed, and hard reset options
2. WHEN the user selects a reset mode, THE Workstation SHALL display a Confirmation_Overlay with a warning that reset rewrites the Current_Branch history
3. WHEN the reset completes, THE Workstation SHALL record the previous HEAD position in the Undo_Stack so that the operation can be reversed with `g u`
4. WHEN a hard reset is selected, THE Workstation SHALL include an additional warning in the Confirmation_Overlay stating that uncommitted changes will be permanently lost
5. WHEN the Cursored_Branch is the same as the Current_Branch, THE Workstation SHALL reject the reset and display a message stating there is nothing to reset

### Requirement 4: Push After Merge or Reset

**User Story:** As a developer, I want to push immediately after a merge or reset completes, so that I can publish changes in a single flow without extra keystrokes.

#### Acceptance Criteria

1. WHEN a Merge_Operation or Fast_Forward_Merge completes successfully, THE Workstation SHALL include a Momentum_Hint naming the push keybinding
2. WHEN a Reset_To_Ref operation completes and the remote tracking branch exists and the reset moved the branch pointer backward (history rewrite), THE Workstation SHALL include a Momentum_Hint suggesting force-push as the next action
3. WHEN the user presses the force-push keybinding in the Branches_View, THE Workstation SHALL display a Confirmation_Overlay with a warning that force-push rewrites remote history
4. WHEN a force-push is confirmed, THE Workstation SHALL execute `git push --force-with-lease` for the Current_Branch
5. IF a force-push fails because the remote has unseen commits, THEN THE Workstation SHALL display an error message recommending a fetch before retrying

### Requirement 5: Pull Strategy Choice

**User Story:** As a developer, I want to choose between pull-with-rebase and pull-with-merge when my local branch has diverged from the remote, so that I control how divergent histories are reconciled.

#### Acceptance Criteria

1. WHEN the user presses the pull keybinding and the pull fails due to divergence, THE Workstation SHALL present a strategy-choice prompt offering rebase and merge options
2. WHEN the user selects rebase, THE Workstation SHALL execute `git pull --rebase` and display a success message on completion
3. WHEN the user selects merge, THE Workstation SHALL execute `git pull --no-rebase` and display a success message on completion
4. WHEN a pull-with-rebase encounters conflicts, THE Workstation SHALL transition to the Conflicts_View
5. WHEN a pull-with-merge encounters conflicts, THE Workstation SHALL transition to the Conflicts_View
6. WHEN the pull succeeds without divergence (fast-forward), THE Workstation SHALL complete silently with a success Momentum_Hint

### Requirement 6: Sync Branch Operation

**User Story:** As a developer, I want a single-keystroke sync operation that pulls and then pushes, so that I can bring my branch fully up to date with the remote in one action.

#### Acceptance Criteria

1. WHEN the user triggers the sync keybinding in the Branches_View, THE Workstation SHALL execute a pull followed by a push as a single compound workflow
2. WHEN the pull phase of a Sync_Operation fails due to divergence, THE Workstation SHALL present the strategy-choice prompt before continuing
3. WHEN the pull phase of a Sync_Operation encounters conflicts, THE Workstation SHALL abort the sync, transition to the Conflicts_View, and display a message that sync was interrupted
4. WHEN the push phase of a Sync_Operation fails, THE Workstation SHALL display an error message with the failure reason and leave the successful pull result intact
5. WHEN a Sync_Operation completes both phases successfully, THE Workstation SHALL display a single success message stating the branch is fully synchronized
6. WHEN the Current_Branch has no upstream configured, THE Workstation SHALL reject the sync and display a message suggesting `u` to set an upstream first

### Requirement 7: Conflict Handling

**User Story:** As a developer, I want merge and pull operations that produce conflicts to route me directly to the conflicts view, so that I can resolve them without manual navigation.

#### Acceptance Criteria

1. WHEN a Merge_Operation produces conflicts, THE Workstation SHALL automatically navigate to the Conflicts_View
2. WHEN a pull-with-rebase produces conflicts, THE Workstation SHALL automatically navigate to the Conflicts_View
3. WHEN a pull-with-merge produces conflicts, THE Workstation SHALL automatically navigate to the Conflicts_View
4. WHEN the Conflicts_View is reached via a branch operation, THE Workstation SHALL display a status message identifying the operation that caused the conflicts

### Requirement 8: Undo Support

**User Story:** As a developer, I want to undo merge and reset operations when possible, so that I can recover from mistakes without leaving the TUI.

#### Acceptance Criteria

1. WHEN a Merge_Operation completes, THE Workstation SHALL record the pre-merge HEAD in the Undo_Stack
2. WHEN a Reset_To_Ref operation completes, THE Workstation SHALL record the pre-reset HEAD and the reset mode in the Undo_Stack
3. WHEN the user triggers undo (`g u`) after a merge, THE Workstation SHALL reset the Current_Branch back to the pre-merge commit
4. WHEN the user triggers undo (`g u`) after a reset, THE Workstation SHALL reset the Current_Branch back to the pre-reset commit using the same mode that was originally used
5. IF a Merge_Operation has already been pushed to the remote, THEN THE Workstation SHALL still allow local undo but display a warning that the remote remains unchanged

### Requirement 9: Feedback and Status Messages

**User Story:** As a developer, I want clear loading, success, and error states for all branch operations, so that I always know what the TUI is doing.

#### Acceptance Criteria

1. WHILE a branch operation is in progress, THE Workstation SHALL display a loading indicator in the footer with the operation name
2. WHEN a branch operation succeeds, THE Workstation SHALL display a success message in the footer using the success glyph and color
3. WHEN a branch operation fails, THE Workstation SHALL display an error message in the footer using the error glyph and color, including the reason for failure
4. WHEN a force-push warning is displayed, THE Workstation SHALL use the warning glyph and color to distinguish it from informational messages
5. THE Workstation SHALL format all success messages as Momentum_Hints that name the next logical keystroke

### Requirement 10: Confirmation Prompts

**User Story:** As a developer, I want appropriate confirmation gates on destructive operations, so that I cannot accidentally rewrite history with a single errant keystroke.

#### Acceptance Criteria

1. WHEN the merge keybinding is pressed, THE Workstation SHALL require y-confirm before executing the merge
2. WHEN the reset keybinding is pressed, THE Workstation SHALL require y-confirm before executing the reset
3. WHEN the force-push keybinding is pressed, THE Workstation SHALL require y-confirm before executing the force-push
4. WHEN the sync keybinding is pressed, THE Workstation SHALL execute without additional confirmation because the pull+push sequence is non-destructive under normal conditions
5. WHEN a confirmation panel is displayed for force-push, THE Workstation SHALL include a danger-level warning that remote history will be rewritten, and SHALL block force-push execution entirely if the danger warning fails to display — requiring both user confirmation AND successful warning rendering before proceeding

### Requirement 11: Keybinding Assignments

**User Story:** As a developer, I want intuitive keybindings for the new operations that avoid collisions with existing keys in the branches view.

#### Acceptance Criteria

1. THE Workstation SHALL assign `M` to the merge operation in the Branches_View
2. THE Workstation SHALL assign `Z` to the reset-to-ref operation in the Branches_View (matching the history view reset convention)
3. THE Workstation SHALL assign `Shift+P` (capital `P`) with a force modifier or a sub-choice to expose force-push in the Branches_View
4. THE Workstation SHALL assign `S` to the sync operation in the Branches_View
5. THE Workstation SHALL retain the existing `U` keybinding for pull but enhance it with the divergence strategy-choice prompt
6. WHEN a new keybinding is registered and a collision with an existing binding in the same context is detected by `inkKeymap.collisions.test.ts`, THE Workstation SHALL block registration entirely rather than auto-reassigning the conflicting binding

### Requirement 12: Command Palette Entries

**User Story:** As a developer, I want all new operations discoverable through the command palette, so that I can find them by name even if I forget the keybinding.

#### Acceptance Criteria

1. THE Workstation SHALL register a "Merge branch into current" entry in the Command_Palette accessible from the Branches_View
2. THE Workstation SHALL register a "Reset current branch to ref" entry in the Command_Palette accessible from the Branches_View
3. THE Workstation SHALL register a "Force push current branch" entry in the Command_Palette accessible from the Branches_View
4. THE Workstation SHALL register a "Sync branch (pull + push)" entry in the Command_Palette accessible from the Branches_View
5. THE Workstation SHALL register a "Pull with rebase" and "Pull with merge" entry in the Command_Palette accessible from the Branches_View

### Requirement 13: Progressive Disclosure

**User Story:** As a developer, I want new operations surfaced in footer hints and help views, so that I discover them naturally as I use the branches view.

#### Acceptance Criteria

1. WHEN the Branches_View is active, THE Workstation SHALL include merge, reset, and sync in the footer hint band (space permitting per the narrow-terminal trimming rules)
2. WHEN the user presses `g?` in the Branches_View, THE Workstation SHALL list all new branch operations with their keybindings in the which-key strip
3. WHEN the user presses `?` for full help, THE Workstation SHALL include a "Branch operations" section listing merge, reset, force-push, sync, and pull-strategy actions with descriptions
4. THE Workstation SHALL respect the existing footer hint budget so that the 80x24 terminal floor remains functional without overflow
