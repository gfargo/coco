# coco CLI command-surface bug audit

**Target:** `/projects/sandbox/coco` (`git-coco` v0.84.1)
**Scope:** `src/commands/**` (excluding `agent/`, `mcp/`) + `src/index.ts`, plus the shared helpers those command handlers call (`lib/ui/*`, `lib/config/**` writers, `lib/simple-git/createCommit`).
**Method:** full read of every in-scope `config.ts`/`handler.ts` pair, flag-by-flag cross-check of declared vs. consumed options, plus empirical `npx tsx` yargs probes (probe file deleted; no files added or changed inside the repo).

None of the findings below are caught by the existing gate (`tsc --noEmit` clean, eslint only react-hooks warnings, 391 suites / 5596 tests passing). Where a co-located test *encodes* the buggy behavior, that is called out explicitly.

---

## HIGH

### [SEVERITY: high] fix(config): `coco config set …apiKey --scope global` writes the key world-readable (0644) and non-atomically
**File:** `src/lib/config/utils/scopedConfigFile.ts:72-80` (also `src/lib/config/services/xdg.ts:62`)
**What's wrong:** `coco config set` is the documented way to write config, including credentials (`config/handler.ts` even has a `SENSITIVE_SEGMENTS` masker for `apikey`, `token`, `password`, `clientsecret`, so credentials are clearly expected to live here). The writer uses a bare `fs.writeFileSync` with no `mode`, so the file lands at `0666 & ~umask` — 0644 on a default umask — and any local user can read the API key. The repo already ships the correct primitive: `writeFileAtomic` defaults to `mode: 0o600` and does tmp+rename (`src/lib/utils/atomicFileWrite.ts:29-40`), and is used for less sensitive files (CHANGELOG). The plain `writeFileSync` is also non-atomic: an interrupted write truncates the user's whole global config.
**Evidence:**
```ts
export function writeScopedConfigFile(filePath: string, config: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const { $schema, ...rest } = config
  fs.writeFileSync(
    filePath,
    JSON.stringify({ $schema: SCHEMA_PUBLIC_URL, ...rest }, null, 2) + '\n'
  )
}
```
**Impact:** `coco config set service.authentication.credentials.apiKey sk-… --scope global` → `~/.config/coco/config.json` is `-rw-r--r--` containing a plaintext provider key. Reproduce: run the command, then `stat -c %a ~/.config/coco/config.json` → `644`. `persistUsagePreference` (xdg.ts:62) writes the same file the same way, so it can also *downgrade* a hand-hardened 0600 file back to 0644 (it rewrites the whole file).
**Suggested fix:** route both writers through `writeFileAtomic(filePath, data)` (0600 default, tmp+rename); optionally `chmodSync(file, 0o600)` on pre-existing files before write.
**Confidence:** high

### [SEVERITY: high] fix(init): `--scope project` silently clobbers an existing `.coco.json`, dropping every unrelated key
**File:** `src/lib/config/services/project.ts:251-266` (called from `src/commands/init/handler.ts:349`)
**What's wrong:** the function is named `appendToProjectJsonConfig`, but it does a full overwrite: it never reads the existing file, so any keys the user (or a prior `coco doctor --fix`) put there — `logTui.theme`, `workspace.roots`, `ignoredFiles`, `prompt`, `forgeHosts`, `telemetry` — are destroyed. There is no "existing config found, override?" confirmation, even though the codebase *has* one (`CONFIG_ALREADY_EXISTS` in `lib/ui/helpers.ts:45`) and the sibling global path uses it (`git.ts:230-235` passes `confirmUpdate: true, confirmMessage: CONFIG_ALREADY_EXISTS` to `updateFileSection`). So the global scope asks before touching `~/.gitconfig`, and the project scope silently truncates `.coco.json`.
**Evidence:**
```ts
export const appendToProjectJsonConfig = (filePath: string, config: Partial<Config>) => {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, '{}')
  }
  fs.writeFileSync(filePath, JSON.stringify({ $schema: SCHEMA_PUBLIC_URL, ...config }, null, 2))
}
```
**Impact:** re-running `coco init --scope project` (e.g. to change the model) wipes a committed `.coco.json` down to `{defaultBranch, mode, service}` and reports `init successful! 🦾🤖🎉`. Reproduce: add `"logTui": {"theme":{"preset":"dracula"}}` to `.coco.json`, run `coco init --scope project`, accept — the key is gone.
**Suggested fix:** read-merge-write (deep merge `service`), and prompt with `CONFIG_ALREADY_EXISTS(filePath)` when the file already exists; write via `writeFileAtomic(..., { preserveExistingMode: true })`.
**Confidence:** high

### [SEVERITY: high] fix(commit): `--split` apply resets the index up front and never restores staging for failed groups
**File:** `src/commands/commit/split.ts:533` / `:653-676`
**What's wrong:** `applyCommitSplitPlan` unstages *everything* (`git reset`) before the loop, then re-stages per group. Only files the plan never saw (config-filtered lockfiles) are re-added afterwards (`:653`). Files belonging to a group whose commit failed stay unstaged forever — and if *every* group fails, the function throws with the index still empty. There is no rollback of the reset and no mention of it in either the partial-success message or the thrown error, so a user who ran `coco commit --split --apply` on a hand-curated index loses that curation with no warning.
**Evidence:**
```ts
await git.raw(['reset'])
…
if (commitHashes.length === 0) {
  logger.stopSpinner('Split apply failed', { mode: 'fail', color: 'red' })
  const detail = failures.map((f) => `  - ${f.title}: ${f.reason}`).join('\n')
  throw new Error(`Split apply created zero commits across ${applicableGroups.length} group(s).${abortedNote}\n${detail}`)
}
```
**Impact:** a pre-commit hook that rejects the first group (or a `git apply --cached` conflict, or a mid-run SIGINT) leaves the user with an empty index and a message that says only "Created 1 of 2 planned commit(s). Failed: …". Reproduce: stage two files, make a hook reject one, run `coco commit --split --apply`, then `git diff --cached --name-only` → empty for the failed group's files. The co-located test **encodes** this: `splitApply.test.ts:84-90` asserts `ops` ends at `['…','reset','stage a.ts','reset','stage b.ts']` with no re-add of `a.ts`.
**Suggested fix:** capture `stagedBeforeReset` (already computed at `:528`) and, on any failure path (including the zero-commit throw), re-`git add --` the files of failed/unattempted groups; state explicitly in the message which paths were left unstaged.
**Confidence:** high

### [SEVERITY: high] fix(cli): the default router drops global `--json` / `--quiet`, so `coco --commit --json` performs a real commit
**File:** `src/commands/defaultRouter.ts:155-170`
**What's wrong:** `buildSyntheticArgv` hand-projects the fields it forwards and omits `json` and `quiet`. Every route (`init`, `ui`, `workspace`, `commit`) therefore runs as if those globals were never passed. For the `commit` route this is not cosmetic: `commit/handler.ts:65` uses `argv.json` as the "generate a draft, don't commit" switch, so losing the flag flips a preview into a mutation.
**Evidence:**
```ts
  return ({
    _: ['$0'], $0: argv.$0, repo: argv.repo, cwd: argv.cwd,
    verbose: argv.verbose, interactive: true, version: false, help: false,
    ...overrides,
  } as unknown) as T
```
**Impact:** `coco --commit --json` (the documented legacy escape hatch, also reachable via `COCO_DEFAULT=commit`) is expected to print `{"title","body"}`; instead, with the `mode: "interactive"` config `coco init` writes by default, it opens the interactive review loop and creates a commit. `coco --commit --quiet` likewise ignores `--quiet`. Reproduce: `COCO_DEFAULT=commit coco --json` in a repo with staged changes.
**Suggested fix:** forward `json` and `quiet` (and `$0`-level unknowns generally) in `buildSyntheticArgv`; ideally spread `argv` and override only the command-specific fields.
**Confidence:** high

### [SEVERITY: high] fix(commit): `--split`'s "unclaimed" group silently unstages files and the CLI never says so
**File:** `src/commands/commit/split.ts:478-489` + `:660-686`
**What's wrong:** `rescueMissingFiles` (`splitPlanValidation.ts:437-482`) appends a synthetic `unclaimed: true` group for files the model failed to place, and validation then treats those files as "claimed" so the plan passes. Apply-time, `applicableGroups` filters unclaimed groups out — but the up-front `git reset` already unstaged them, and they are excluded from the `unplannedStaged` restore because `plannedFiles` counts *every* group including unclaimed. The final message (`Created N split commit(s).`) mentions only the config-filtered restore, never the unclaimed files.
**Evidence:**
```ts
    if (group.unclaimed) {
      return false
    }
```
```ts
  const unplannedNote = unplannedStaged.length > 0
    ? ` ${unplannedStaged.length} staged file(s) the plan excluded by config (e.g. lockfiles) were re-staged — commit them separately.`
    : ''
```
**Impact:** `coco commit --split --apply` in CI/non-TTY reports success while N staged files were dropped from the index and from every commit. The comment at `:479-481` claims the user "lands on the status screen to handle them" — true only for the Workstation surface, not for the CLI path this code also serves.
**Suggested fix:** re-stage unclaimed-group files after the loop and append an explicit note (`M file(s) were left uncommitted and remain staged: …`) to `CommitSplitApplyResult.message`.
**Confidence:** high

---

## MEDIUM

### [SEVERITY: medium] fix(cli): global `--quiet` swallows command *results*, not just chrome
**File:** `src/commands/utils/githubListCommand.ts:195`, `src/commands/doctor/handler.ts:164+`, `src/commands/config/handler.ts:108/126/151`, `src/commands/review/handler.ts:396-400`, `src/commands/prCreate/handler.ts:110`
**What's wrong:** `--quiet` is documented as "Suppress non-error status output. Results (and --json) still print to stdout" (`src/index.ts:76-80`, README:79). That holds only for commands that write results via `process.stdout.write`/`emitJson`. Commands that emit their payload through `logger.log` lose it entirely, because `Logger.log` early-returns when muted (`lib/utils/logger.ts:56-58`).
**Evidence:**
```ts
    logger.log(spec.formatList(items, listNoun))        // prs / issues: the entire table
```
```ts
    logger.log(chalk.bold('Review findings:\n'))
    logger.log(formatFindings(findings))                // review, non-TTY path
```
**Impact:** `coco prs --quiet`, `coco issues --quiet`, `coco doctor --quiet`, `coco config get service.model --quiet`, `coco config list --quiet`, `coco pr create --dry-run --quiet`, and `coco review --quiet` (piped/CI) all print **nothing at all** and exit 0. `config set --quiet` additionally hides the schema-mismatch warning from `warnIfInvalid` while still writing the file.
**Suggested fix:** write final results through `process.stdout.write` (as `handleResult`/`emitJson` do), or add a `logger.result()` channel that ignores quiet; keep only banners/spinners/status behind quiet.
**Confidence:** high

### [SEVERITY: medium] fix(review): `--pr <non-numeric>` becomes `NaN` and is passed straight to the forge
**File:** `src/commands/review/config.ts:76-80` + `:88-112`, used at `src/commands/review/handler.ts:97/116`
**What's wrong:** the builder's `.check()` was hardened for `--severity` NaN (#1599) but the same yargs `type: 'number'` hole was left open on `--pr`. `NaN !== undefined`, so every `argv.pr !== undefined` guard passes.
**Evidence:**
```ts
  const forge = argv.pr !== undefined
```
Probe (`yargs` with the real builder): `review --pr notanumber` → `fail: null`, `{ pr: NaN, mr: NaN }`.
**Impact:** `coco review --pr abc` (or `--mr abc`, or a shell variable that expanded empty-ish) resolves the forge, then calls `getPullRequestDiffByNumber(NaN)` → `gh pr diff NaN`; the user gets a forge-level error instead of "`--pr` must be a positive integer". With `--comment` it would also try to post to PR `NaN`.
**Suggested fix:** extend the existing `.check()`: `if (pr !== undefined && !(Number.isInteger(pr) && pr > 0)) throw new Error('--pr must be a positive integer')`.
**Confidence:** high

### [SEVERITY: medium] fix(review): a generation failure and a severity-gate breach both exit 1 — CI can't tell them apart
**File:** `src/commands/review/handler.ts:367-372`, `:406-412`
**What's wrong:** the CI gate exits 1 via `commandExit(1)`, and *any* other failure (no API key → `handleMissingApiKey`'s `commandExit(1)`, rate limit, unparseable model output, missing `gh`) also lands on exit code 1 through `commandExecutor`'s catch (`lib/utils/commandExecutor.ts:303`). A pipeline gating on `coco review --severity 7` cannot distinguish "the reviewer found blocking issues" from "the reviewer never ran".
**Evidence:**
```ts
  if (exceedsThreshold) {
    logger.log(`Review found ${…} finding(s) at or above severity ${severityThreshold}.`, { color: 'red' })
    commandExit(1)
  }
```
**Impact:** infrastructure flakes are indistinguishable from real review failures; teams either ignore the gate or block on transient errors. Reproduce: `unset OPENAI_API_KEY; coco review --severity 7 --json; echo $?` → `1` with no JSON, same code as a genuine breach.
**Suggested fix:** reserve a dedicated code for the gate (e.g. `commandExit(2)` for "findings at/above threshold"), document it, and keep 1 for operational failure.
**Confidence:** high

### [SEVERITY: medium] fix(review): `--comment` post failure is logged but the command still exits 0
**File:** `src/commands/review/handler.ts:374-385`
**What's wrong:** when the forge rejects the comment / request-changes call (permissions, closed PR, `gh` not authenticated for that host), the failure is printed and execution falls through; nothing sets a non-zero exit.
**Evidence:**
```ts
    if (postResult.ok) {
      logger.log(postResult.message, { color: 'green' })
    } else {
      logger.error(postResult.message, { color: 'red' })
    }
```
**Impact:** a CI job whose whole purpose is "post the review to the PR" reports success while nothing was posted (unless the severity gate happens to fire independently). Reproduce: `coco review --pr <n> --comment` with a read-only token → stderr message, `echo $?` → `0`.
**Suggested fix:** `commandExit(1)` on `!postResult.ok` (or accumulate and exit non-zero at the end, distinct from the severity code).
**Confidence:** high

### [SEVERITY: medium] fix(doctor): `--json` is ignored for the main diagnostics report, which prints ANSI art to stdout
**File:** `src/commands/doctor/handler.ts:141-166`
**What's wrong:** `argv.json` is only honored inside the `--clear` and `--cost` branches. The default diagnostics path unconditionally logs the logo, the config-source list, and the diagnostics table via `logger.log` (i.e. `console.log` → stdout), with no JSON payload anywhere. `doctor/config.ts:32` nevertheless advertises `// --json is a global flag`.
**Evidence:**
```ts
  if (argv.cost) { … renderCostReport(config, logger, Boolean(argv.json)); return }

  logger.log(LOGO)
  logger.log('')
  logger.log(chalk.bold('coco doctor') + ' — checking your configuration\n')
```
**Impact:** `coco doctor --json | jq .` fails on the first byte (a box-drawing logo). Since `doctor` is the recommended pre-flight check, this breaks exactly the machine consumer the flag exists for.
**Suggested fix:** emit `{ sources, diagnostics: [{severity, message, fix}], errors, warnings }` via `emitJson` and suppress all `logger.log` chrome when `argv.json` is set (the pattern recap/review/changelog already use).
**Confidence:** high

### [SEVERITY: medium] fix(cli): `--json` failure payloads are inconsistent — most commands emit plain text on stderr and nothing on stdout
**File:** `src/commands/amend/handler.ts:80-87`, `src/commands/review/handler.ts:120-122`, `src/commands/prCreate/handler.ts:89-101`, `src/commands/changelog/handler.ts:109-111`, `src/commands/utils/githubListCommand.ts:141-172`
**What's wrong:** `commit` (`handler.ts:73-81`) and `recap` (`handler.ts:316-320`) deliberately emit `{"error": …}` in JSON mode so machine consumers get a parseable failure. Every other `--json`-capable command exits 1 with an empty stdout: `amend` logs the draft errors through `logger`/`logger.error` *before* its `if (argv.json)` branch and never emits JSON; `review`, `pr create`, `changelog`, `prs`, `issues` do the same for their forge/validation failures.
**Evidence (amend — `argv.json` is checked only after the failure return):**
```ts
  if (!result.ok || !result.draft) {
    for (const warning of result.warnings) logger.log(warning, { color: 'yellow' })
    for (const error of result.validationErrors) logger.error(error, { color: 'red' })
    commandExit(1)
    return
  }
  …
  if (argv.json) { emitJson({ previous: previousMessage, message }); return }
```
**Impact:** a wrapper doing `out = $(coco amend --json) || parse_error(out)` gets an empty string and must fall back to scraping stderr. Reproduce: `coco amend --json` in a repo with no changes → exit 1, stdout empty.
**Suggested fix:** pick one contract (`{"error": "..."}` on stdout + non-zero exit) and apply it to every `--json` path; simplest is a shared `emitJsonError(reason)` helper called from each failure branch.
**Confidence:** high

### [SEVERITY: medium] fix(commit): `--split` never validates group titles against commitlint, unlike plain `coco commit`
**File:** `src/commands/commit/split.ts:845-865` (prompt context only) vs `src/commands/commit/handler.ts:373-500`
**What's wrong:** the regular commit path runs `validateCommitMessage` and retries/prompts until the message passes commitlint. The split path only *injects the rules into the prompt* (`commitlintRulesContext`) and then commits each group's `${title}\n\n${body}` verbatim — there is no `validateCommitMessage` call anywhere in `split.ts` (grep confirms: the only importers of `commitlintValidator` in the commit folder are `handler.ts` and `generateCommitDraft.ts`).
**Evidence:**
```ts
      const body = group.body ? `\n\n${group.body}` : ''
      await createCommit(`${group.title}${body}`.trim(), git, undefined, { noVerify: groupNoVerify })
```
**Impact:** in a commitlint repo, `coco commit --split --apply` produces commits that violate the project's own rules; if a `commit-msg` hook exists, git rejects the group and the failure is misreported as a *pre-commit* hook problem (see next finding), with a "Skip hooks" remedy that bypasses the very rule the project wants. The single-group fallback title (`'chore: combined commit'`, `splitPlanValidation.ts:564`) is conventional-safe but would still fail a `scope-enum`/`subject-case` ruleset.
**Suggested fix:** validate each group title (+body) with `validateCommitMessage` at plan time, feed failures back through the existing `previous_attempt_feedback` retry slot, and surface a hard error before touching the index.
**Confidence:** high

### [SEVERITY: medium] fix(git): every non-hook `GitError` is reported as "Commit blocked by pre-commit hook"
**File:** `src/lib/simple-git/createCommit.ts:110-119`
**What's wrong:** after the narrow "hook modified files" and "nothing to commit" checks, *all* remaining `GitError`s are wrapped in `PreCommitHookError`. GPG signing failures, `index.lock` contention, unborn-branch and identity errors (`Please tell me who you are`) all surface through the hook-failure UX.
**Evidence:**
```ts
    if (error instanceof GitError) {
      if (isKnownNonHookCommitFailure(error.message)) { throw error }
      throw new PreCommitHookError(error.message)
    }
```
**Impact:** with `commit.gpgsign=true` and no usable key, `coco commit -i` prints `✖ Commit blocked by pre-commit hook` and offers `⚠️  Skip hooks — Retry with --no-verify` (`lib/ui/hookFailurePrompt.ts:44-52`); `--no-verify` does not disable signing, so the "fix" silently fails again. In `--split` the same misclassification drives the per-group retry/skip loop.
**Suggested fix:** only wrap when the error text actually indicates a hook (`hook`, `pre-commit`, `commit-msg`); otherwise rethrow so `commandExecutor`'s generic formatter shows the real cause.
**Confidence:** high

### [SEVERITY: medium] fix(commit): non-interactive hook failures print "fix the issues above" with the hook output muted
**File:** `src/lib/ui/hookFailurePrompt.ts:27-40` + `src/commands/commit/handler.ts:124`
**What's wrong:** the recovery helper prints the header via `logger.error` (always reaches stderr) but the actual hook output via `logger.log` — and the commit handler mutes the logger for every non-interactive run (`logger.setConfig({ quiet: true })`). The non-interactive branch then tells the user to fix "the issues above", which were suppressed.
**Evidence:**
```ts
  logger.log('\nHook output:', { color: 'yellow' })
  logger.log(SEPERATOR)
  logger.log(hookOutput)
  …
  if (!interactive) {
    logger.error('\nFix the issues above and try again, or use --no-verify to skip hooks.', { color: 'yellow' })
    return 'abort'
  }
```
**Impact:** `coco commit --split --apply` in CI (or `coco commit` with `commit: true` in config) reports a blocked commit with zero diagnostic detail. Reproduce: add a `pre-commit` hook that prints lint errors and exits 1, then run `coco commit --split --apply` — stderr shows only the header and the "fix the issues above" line.
**Suggested fix:** print `hookOutput` with `logger.error` (or `process.stderr.write`) so it survives quiet/non-interactive mode.
**Confidence:** high

### [SEVERITY: medium] fix(commit): `--print-message` failures are completely silent (cause is `verbose`-gated), and skip the missing-API-key hint
**File:** `src/commands/commit/handler.ts:65-82`
**What's wrong:** on the draft-only path, warnings and validation errors are emitted with `logger.verbose`, which no-ops unless `--verbose` is set. The non-JSON branch then exits 1 having printed nothing. This path also bypasses `handleMissingApiKey` (called only later, at `:104`), so the specific "set `OPENAI_API_KEY` / run `coco init`" recovery copy that exists in `lib/ui/handleMissingApiKey.ts` is replaced by silence — `generateCommitDraft` returns `validationErrors: ['No API key configured for the commit service.']` and it is thrown away.
**Evidence:**
```ts
      for (const warning of result.warnings) {
        logger.verbose(warning, { color: 'yellow' })
      }
      for (const validationError of result.validationErrors) {
        logger.verbose(validationError, { color: 'red' })
      }
```
**Impact:** `coco commit --print-message` (the exact command the installed `prepare-commit-msg` hook runs, `hooks/manageHooks.ts:76`) fails with no output and exit 1 — so `git commit` opens an empty editor and the user has no idea coco tried and why it failed. Reproduce: `unset OPENAI_API_KEY; coco commit --print-message; echo $?` → no output, `1`.
**Suggested fix:** print warnings/validation errors with `logger.error` on this path, and call `handleMissingApiKey` before `generateCommitDraft` (or surface its `validationErrors` verbatim).
**Confidence:** high

### [SEVERITY: medium] fix(cli): mutually exclusive flags are silently resolved by precedence instead of validated
**File:** `src/commands/commit/split.ts:988-1010`, `src/commands/commit/handler.ts:65`, `src/commands/amend/handler.ts:25/92-98`, `src/commands/changelog/handler.ts:102-135`
**What's wrong:** several commands accept contradictory flag pairs and pick a winner with no warning. Verified by probe (all parse cleanly under `.strictOptions()`):
- `commit --split --plan --apply` → `{split:true, plan:true, apply:true}`; `if (argv.plan) return formatPlanPreview()` runs first, so `--apply` is dropped.
- `commit --print-message --split` → the print-message early return wins; the split planner never runs.
- `commit --apply` / `--strict-split` alone → `isCommitSplitCommand()` is false (`split.ts:112-116`), so both are silently no-ops.
- `amend --dry-run --apply` → `previewOnly` wins; `--apply` ignored.
- `changelog --only-diff` silently ignores `--range` / `--tag` / `--since-last-tag` (the `exclusiveOptions` guard at `:102-111` never considers `onlyDiff`).
- `doctor --clear --cost` → `--clear` wins, no cost report.
**Evidence:**
```ts
  // --plan: print the plan and exit (opt-out from the default apply prompt).
  if (argv.plan) {
    return formatPlanPreview()
  }
  // --apply: skip the confirmation prompt and apply directly.
  if (argv.apply) {
```
**Impact:** scripts that pass a redundant/incorrect combination get a different behavior than requested with no diagnostic — most consequentially `--split --plan --apply` (user expects commits, gets a preview) and `--apply` alone (user expects a split apply, gets a plain single commit draft). Note `review`'s builder already demonstrates the right pattern with `.check()` for `--comment`/`--pr`/`--branch`/`--staged`.
**Suggested fix:** add `.check()` validation (or `.conflicts()`) per command: reject `--plan` with `--apply`, `--dry-run` with `--apply`, `--print-message` with split flags, `--only-diff` with range selectors, and error on `--apply`/`--strict-split` without `--split`.
**Confidence:** high

### [SEVERITY: medium] fix(changelog): `--write` section replacement scans only to the next `## `, swallowing intervening `# ` release sections
**File:** `src/commands/changelog/writeChangelog.ts:64-78`
**What's wrong:** when an existing `## {title}` section is found, the end of the section is located by scanning forward for the next line starting with `## `. A top-level `# ` heading does not match, so everything from the replaced section down to the next `##` — including any `# [2.0.0]`-style major-release section and all of its body — is deleted. conventional-changelog / standard-version emit exactly that shape (`# [2.0.0]` for majors, `## [1.1.0]` for minors), so this is a realistic layout. Related: `trimmedEnd` is computed (`:71-74`) and then never used — `after` slices from the untrimmed `endIndex`, so the documented "trim the trailing blank lines" behavior is not implemented.
**Evidence:**
```ts
    let endIndex = startIndex + 1
    while (endIndex < lines.length && !lines[endIndex].startsWith('## ')) {
      endIndex += 1
    }
```
**Impact:** re-running `coco changelog --write` for a title that already exists can permanently delete an entire major-version section of CHANGELOG.md (the write itself is atomic, so there's no partial-file symptom to notice — the content is just gone). Reproduce: CHANGELOG with `## v1.2 — …`, then `# [2.0.0]` + body, then `## v1.1`; write section `v1.2` → the `# [2.0.0]` block disappears.
**Suggested fix:** stop the scan at any heading of the same or higher level (`/^#{1,2} /`), and either use `trimmedEnd` or delete it.
**Confidence:** high

### [SEVERITY: medium] fix(amend): `noVerify` from config is ignored (only the CLI flag is honored)
**File:** `src/commands/amend/handler.ts:141`
**What's wrong:** `commit` resolves the setting from both sources (`handler.ts:553`: `const noVerify = argv.noVerify || config.noVerify || false`, and `split.ts:1000`/`:1049` do the same). `amend` reads only `argv.noVerify`, so a user with `noVerify: true` in `.coco.json`/`~/.gitconfig` gets hooks run on amend but skipped on commit.
**Evidence:**
```ts
      { amend: true, noVerify: argv.noVerify }
```
**Impact:** inconsistent, surprising hook behavior between two sibling commands; in a repo with a slow/blocking pre-commit hook, `coco amend` fails where `coco commit` succeeds. Reproduce: set `coco.noVerify=true` in `~/.gitconfig`, add a failing pre-commit hook, run `coco commit` (skips) vs `coco amend` (blocked).
**Suggested fix:** `noVerify: argv.noVerify || config.noVerify || false`.
**Confidence:** high

---

## LOW

### [SEVERITY: low] fix(commit): `openInEditor` is declared as a commit option but has no yargs flag
**File:** `src/commands/commit/config.ts:8` (interface) vs `:80-158` (options map)
**What's wrong:** `CommitOptions.openInEditor: boolean` is part of the command's public option type and is read from config (`handler.ts:480`, `editResult`), but no `openInEditor` entry exists in the yargs `options` map. Under `.strictOptions()` the flag is rejected.
**Evidence:** probe — `commit --open-in-editor` → `fail: Unknown arguments: open-in-editor, openInEditor`.
**Impact:** users reading the type (or the config key) reasonably try `--open-in-editor` and get "Unknown argument"; the behavior is only reachable via config.
**Suggested fix:** declare the flag (`openInEditor: { type: 'boolean', description: … }`) or drop it from the argv-facing interface.
**Confidence:** high

### [SEVERITY: low] fix(cli): numeric flags accept garbage and silently become `NaN`
**File:** `src/commands/commit/config.ts:108-113`, `src/commands/prs/config.ts:73-76`, `src/commands/issues/config.ts:63-66`
**What's wrong:** unlike `review --severity` (guarded) and `log --limit` (normalized in `git/logData.ts:119-127`), these numeric options have no validation. Probe: `commit -p abc` → `withPreviousCommits: NaN` (then `NaN > 0` is false, so the requested commit history is silently omitted); `prs --limit abc` → `limit: NaN`, and `typeof NaN === 'number'` passes the guard at `git/pullRequestListData.ts:150`, so `gh pr list --limit NaN` is executed.
**Evidence:**
```ts
  if (typeof filter.limit === 'number') args.push('--limit', String(filter.limit))
```
**Impact:** a typo/empty shell variable either silently drops context (`-p`) or produces a confusing `gh`-level error instead of a CLI-level one.
**Suggested fix:** add `.check()` integer/range validation (or `coerce` with an explicit throw) for `withPreviousCommits` and `limit`.
**Confidence:** high

### [SEVERITY: low] fix(commit): `noResult` prints "Changes not staged for commit:" headings with no content unless `--verbose`
**File:** `src/commands/commit/noResult.ts:28-40`
**What's wrong:** the section headings use `logger.log` but the file lists use `logger.verbose`, which no-ops without `--verbose`.
**Evidence:**
```ts
      logger.log('\nChanges not staged for commit:', { color: 'yellow' })
      logger.verbose(`\t${unstaged.map(({ summary }) => summary).join('\n\t')}`, { color: 'red' })
```
**Impact:** `coco commit` with only unstaged work prints two dangling headings and no file names — the actionable part (which files to `git add`) is hidden behind a flag.
**Suggested fix:** use `logger.log` for the lists (they are short), or drop the headings when the body is suppressed.
**Confidence:** high

### [SEVERITY: low] fix(cli): `handleResult` is not awaited in changelog and recap
**File:** `src/commands/changelog/handler.ts:422`, `src/commands/recap/handler.ts:325`
**What's wrong:** both call the async `handleResult({...})` without `await` (commit and log do await it). In interactive mode the `interactiveModeCallback` (`logSuccess`) therefore races the following `logLlmTelemetrySummary` call, and any rejection becomes an unhandled promise rejection outside `commandExecutor`'s try/catch.
**Evidence:**
```ts
  handleResult({
    result: changelogMsg,
    interactiveModeCallback: async () => { logSuccess() },
    mode: MODE as 'interactive' | 'stdout',
  })
  logLlmTelemetrySummary(logger, 'changelog')
```
**Impact:** out-of-order output in interactive mode; a future throw inside the callback would escape error handling entirely.
**Suggested fix:** `await handleResult(...)`.
**Confidence:** high

### [SEVERITY: low] fix(workspace): handler always `process.exit(0)`, masking failures and bypassing pending writes
**File:** `src/commands/workspace/handler.ts:168-172`
**What's wrong:** the force-exit (added to avoid lingering `gh` child processes) hardcodes code 0 and runs immediately after `flushWorkspaceTrace()`, discarding any `process.exitCode` an inner surface set and cutting off asynchronous flushes (cache writes, ledger appends).
**Evidence:**
```ts
  await startCocoWorkspace(argv)
  flushWorkspaceTrace()
  process.exit(0)
```
**Impact:** `coco workspace` can never report a non-zero exit, and a just-issued overview/commit cache write can be truncated. (Related, minor: `commandExit`-based exits everywhere else use `process.exitCode`, which flushes correctly — this is the one hard `process.exit` in the command layer.)
**Suggested fix:** `process.exitCode = process.exitCode ?? 0` plus `process.exit()` after an explicit flush, or unref the offending child process instead of force-exiting.
**Confidence:** medium

### [SEVERITY: low] fix(commit): the split apply confirmation defaults to "yes"
**File:** `src/commands/commit/split.ts:1034-1037`
**What's wrong:** the only confirmation gate before rewriting the index and creating N commits defaults to accept, so a stray Enter applies the plan.
**Evidence:**
```ts
  const shouldApply = await confirmPrompt({
    message: `Apply these ${plan.groups.filter((g) => !g.unclaimed).length} commits?`,
    default: true,
  })
```
**Impact:** an accidental Enter (common when the plan preview scrolls past) performs a destructive, multi-commit, index-resetting operation. Contrast `init`'s advanced prompts, which default to `false`.
**Suggested fix:** `default: false` for this prompt (it is the destructive one), or require typing the group count.
**Confidence:** high

### [SEVERITY: low] fix(recap): shortcut timeframe flags silently override an explicit `--timeframe`
**File:** `src/commands/recap/handler.ts:66-78`
**What's wrong:** the ternary chain resolves `--last-month`/`--last-tag`/`--yesterday`/`--last-week`/`--current-branch` before ever looking at `argv.timeframe`, which `config.ts:63-67` documents as "canonical form of the shortcut flags above".
**Evidence:**
```ts
  const timeframe = lastMonth ? 'last-month' : lastTag ? 'last-tag' : yesterday ? 'yesterday' : lastWeek ? 'last-week'
    : argv.currentBranch || config.currentBranch ? 'currentBranch'
    : argv.timeframe ?? config.timeframe ?? 'current'
```
**Impact:** `coco recap --yesterday --timeframe last-week` recaps yesterday with no warning about the conflict.
**Suggested fix:** `.check()` that at most one timeframe selector is present.
**Confidence:** high

---

## Areas I checked and found clean

- **`review --severity` NaN handling** — `config.ts:88-99` `.check()` rejects non-integer/out-of-range values, and the handler re-guards with `Number.isFinite` (`handler.ts:367`). Probe confirms `--severity high` fails loudly.
- **`recap --tag <value>`** — the builder's `.check()` (`recap/config.ts:76-93`) correctly rejects the stray positional and points at `coco changelog --tag`.
- **`pr <action>`** — `choices: ['create']` on the positional means `coco pr close` fails natively instead of creating a PR; `cache <subcommand>` and `config <action>`/`hooks <action>` use the same pattern.
- **`--no-cache` reachability** — `prs`/`issues` declare `cache: {default: true}` specifically so yargs' boolean negation works under `.strictOptions()`; probe confirms `--no-cache` → `cache: false`. Same for `ui --no-all`.
- **stdout purity of `emitJson`** — `emitJson`/`handleResult` write directly to `process.stdout`; `ora` spinners go to stderr; `Logger.error` goes to stderr; the project/XDG config `console.warn`s go to stderr. recap/review/changelog additionally mute the logger in `--json` mode. (The one gap: `commit --json --verbose` never mutes the logger, so `logger.verbose`/`stopTimer` lines would land on stdout — worth a one-line `setConfig({quiet:true})` but not user-visible without `--verbose`.)
- **Exit codes / flushing** — all exits route through `commandExit` → `CommandExitError` → `process.exitCode` in `commandExecutor`, so stdout is never truncated; prompt cancellation is mapped to 130 (`commandExecutor.ts:275-278`).
- **Non-TTY prompt guards** — `cache prefetch` with no args checks `process.stdin.isTTY` and prints an explicit non-interactive hint; `commit --split` deliberately behaves like `--plan` instead of prompting when not interactive (`split.ts:1013-1023`); `promptHookFailureRecovery` degrades to `abort`; `review` falls back to a static render when `!process.stdin.isTTY && !process.stdout.isTTY`.
- **`hooks install/uninstall/status`** — marker-based idempotency, `mode: 0o755` on both the hook and the backup, `lstat`-based symlink refusal with `--force` opt-in, backup-collision refusal, `git rev-parse --git-path hooks` (honors `core.hooksPath`/worktrees), restore-on-uninstall, and a hook script that fails open (`|| exit 0`) and never clobbers an existing message.
- **`--repo`/`--cwd` global** — every in-scope handler calls `applyRepoFlag`/`applyRepoCwd` before `loadConfig` (including the changelog handler's extra pre-`loadConfig` `applyRepoCwd` at `:390`); no command silently ignores it.
- **Split plan validation core** — `getPlanValidationIssues` covers unknown/duplicate/mixed/partial/missing files and hunks; `dropEmptyGroups` runs last and is re-asserted defensively at apply time; apply-time drift detection exists for file-mode claims (`assertNoStagedDriftSincePlan`) and unstaged-overlap is rejected up front; `git apply --cached` failures are captured with stderr.
- **`log`** — `normalizeLimit` (`git/logData.ts:115-127`) handles `NaN`/`<1`; empty-repo short-circuit emits `[]` in JSON mode and exits 0; `--format json`/global `--json` agree.
- **Short-flag aliases** — `flagAliasConsistency.test.ts` enforces no intra-command letter collisions and the `-t`/`-c` reservations; I found no new collisions (the global `-v`/`-q` do not clash with any command's aliases).
