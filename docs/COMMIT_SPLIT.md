# Commit Split

Commit split helps turn a broad staged change set into smaller, related commits.

## Commands

```bash
coco commit split --plan
coco commit split --apply
```

`--plan` is non-mutating. It reads staged changes, condenses the diffs using the existing
diff parser, and asks the configured model to group files into proposed commits.

`--apply` starts from a generated plan and creates one commit per group. The first
implementation is file-level only. It intentionally aborts if a planned file also has
unstaged or untracked changes, because staging the whole file would otherwise mix unrelated
work into a generated commit.

## Safety Rules

- Every staged file must appear exactly once in the plan.
- Plan files must match real staged files.
- Apply mode unstages the current index, stages one group at a time, and uses the existing
  `createCommit` utility.
- Unstaged overlap blocks apply mode.

## Hunk-Level Follow-Up

Hunk-level grouping is intentionally not applied yet. It needs a structured patch parser and
safe staging strategy because one file can contain unrelated staged and unstaged changes. The
safe path is to prototype hunk staging in temp repositories before adding an apply mode that
can split a single file across multiple commits.
