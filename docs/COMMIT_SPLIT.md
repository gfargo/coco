# Commit Split

Commit split helps turn a broad staged change set into smaller, related commits.

## Commands

```bash
coco commit split --plan
coco commit split --apply
```

`--plan` is non-mutating. It reads staged changes, condenses the diffs using the existing
diff parser, builds a staged hunk inventory for modified files, and asks the configured
model to group files or hunks into proposed commits.

`--apply` starts from a generated plan and creates one commit per group. Whole-file groups
stage the listed files. Hunk groups apply selected staged hunks directly to the index with
`git apply --cached`, which allows separate commits from different parts of the same file.

Whole-file groups intentionally abort if a planned file also has unstaged or untracked
changes, because staging the whole file would otherwise mix unrelated work into a generated
commit. Hunk groups do not stage the whole file.

## Safety Rules

- Every staged file must appear exactly once in the plan.
- A file can be assigned either as a whole file or by all of its hunk IDs, but not both.
- If a file is split by hunks, every generated hunk for that file must be assigned exactly once.
- Plan files must match real staged files.
- Plan hunks must match real staged hunk IDs.
- Apply mode unstages the current index, stages one group at a time, applies selected hunks
  with `git apply --cached`, and uses the existing `createCommit` utility.
- Unstaged overlap blocks whole-file apply mode.

## Hunk-Level Limits

Hunk-level apply is intentionally fail-closed. If a generated hunk patch cannot be applied
cleanly after earlier split commits have changed the file, the command stops and leaves the
remaining working tree changes available for manual review.
