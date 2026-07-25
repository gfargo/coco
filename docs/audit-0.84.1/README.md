# Post-0.84.1 audit — bug findings and feature scoping

A full-repository audit run against `main` at `c36ad0a` (`chore: release v0.84.1`), covering
every layer: `lib/`, `git/` + the forge adapter, `workstation/`, and the CLI command
surfaces, plus a forward-looking feature/extension scoping pass.

**Totals: 77 bug findings and 28 feature proposals.**

| Report | Scope | Findings |
| --- | --- | --- |
| [`bugs-workstation.md`](./bugs-workstation.md) | `src/workstation/**` — runtime, hooks, chrome, surfaces | 19 (1 critical, 6 high, 9 medium, 3 low) |
| [`bugs-commands.md`](./bugs-commands.md) | `src/commands/**` + `src/index.ts` (excl. `agent/`, `mcp/`) | 25 (5 high, 13 medium, 7 low) |
| [`bugs-git-forge.md`](./bugs-git-forge.md) | `src/git/**` — git actions + multi-forge adapter | 22 (5 high, 12 medium, 5 low) |
| [`bugs-lib.md`](./bugs-lib.md) | `src/lib/**` — config, providers, tokenizer, parsers, cache | 11 (1 high, 7 medium, 3 low) |
| [`feature-scoping.md`](./feature-scoping.md) | Forge/provider matrices + new capabilities | 28 proposals (9 P0, 12 P1, 7 P2) |

## Why a static audit found 77 things when CI is green

The validation gate was run first, in full, and it passes cleanly:

| Check | Result |
| --- | --- |
| `npx tsc --noEmit -p tsconfig.json` | clean, exit 0 |
| `npx eslint src bin e2e` | 42 problems — **0 errors**, 42 warnings, all `react-hooks/exhaustive-deps` |
| `TZ=UTC NODE_OPTIONS=--experimental-vm-modules npx jest` | 391 passed / 3 skipped of 394 suites; 5596 tests; 68 snapshots; 81s; exit 0 |

So every finding below is something the current gate cannot see. That is the useful signal
in this audit, and it points at specific gate gaps: no assertion that layout panes tile to
the terminal width, no unmount-cleanup lint for `AbortController`/timer refs, no
`config.ts`-vs-`handler.ts` flag reconciliation test, no ban on `.padEnd` in width-sensitive
surfaces, no unused-production-dependency check, and no stdout-purity test for `--json`.

Where a co-located test *encodes* the buggy behavior, the reports call it out explicitly —
there are five such cases (noted in `bugs-git-forge.md` for Bitbucket PR filtering and the
hardcoded tag remote, `bugs-workstation.md` for the split-plan `r` retry, and
`bugs-commands.md` for the split-apply index reset).

All 42 eslint warnings were individually triaged in `bugs-workstation.md`: 34 are benign
(omitted `useState` setters and ref objects, whose identity React guarantees), 6 are
benign-by-design, and **2 are real** — a `forge` omission that only works today because of
an undocumented coupling to the `git` dep, and `useYankActions` still enumerating
`selected*Index` after the `#1452` selectors moved to `selected*Id`.

## Already-filed work, excluded from this audit

These 15 open issues were read first and deliberately not re-reported: #1830, #1829, #1828,
#1827, #1826, #1825, #1824, #1823, #1822 (the agent/MCP set), #1820, #1819 (rail history
rendering), #1722 (`inkInput.ts` router extraction), #1371 and #1370 (the extensibility and
AI-native umbrellas), and #1241 (Bedrock live verification).

The feature pass also explicitly excludes things that *already ship* and are easy to
mis-propose: shell completions (bash/zsh/fish, `src/index.ts:247-293`), split/side-by-side
diff (`chrome/splitDiff.ts`), Git LFS handling, multi-repo navigation
(`repoStackRuntime.ts`), and `coco review --pr <n> --comment` posting to the forge.

## File these first

Ten items worth landing before anything else, in this order. The first five are correctness
or safety; the last five are cheap and immediately visible.

| # | Item | Why first |
| --- | --- | --- |
| 1 | `fix(config)`: `--ignoredFiles` wipes the default ignore list | **Secret exposure.** Verified empirically: the flag collapses 39 ignore entries to 1, re-admitting `.env`, `.env.local`, and `.env.production.local` to the model prompt. |
| 2 | `fix(config)`: `config set …apiKey` writes 0644, non-atomically | **Secret at rest.** Any local user can read the provider key; `writeFileAtomic` (0600, tmp+rename) already exists and is not used. |
| 3 | `fix(commit)`: `--split` apply resets the index and never restores it | **Data loss.** A hook rejecting one group leaves the user's curated index empty with no warning and no recovery path. |
| 4 | `fix(workstation)`: pane widths can exceed terminal columns | **Only critical.** Reproduced numerically: at 100 cols, `Tab` to sidebar + `?` sums to 116 cols. Breaks the frame at a very common width. |
| 5 | `fix(cli)`: default router drops `--json`/`--quiet` | **Silent mutation.** `coco --commit --json` performs a real interactive commit instead of printing a draft. |
| 6 | `fix(changelog)`: `--write` swallows intervening `# ` release sections | Permanently deletes a major-version section of CHANGELOG.md. |
| 7 | `fix(workstation)`: AbortControllers never aborted on unmount | Four hooks; pressing `q` mid-generation hangs the shell for 30–120s. |
| 8 | `fix(cli)`: `getRepo` logs to **stdout** | One `console.log` breaks `JSON.parse(stdout)` for every `--json` consumer and the agent CLI. |
| 9 | `feat(ci)`: gate the benchmark against `.bench/baseline.json` | Cheapest win in the audit — the baseline is already committed, nothing runs it. |
| 10 | `feat(forge)`: draft→ready and PR reopen | `pr create -d` can create a draft but nothing can promote it; two of three lifecycle steps ship. |

## Suggested issue clustering

77 findings should not become 77 issues. Recommended grouping:

- **File individually (the 17 high + 1 critical):** each has a distinct root cause, owner
  surface, and acceptance criteria.
- **Cluster into one issue each:**
  - *Argument-injection guard parity* — `checkoutBranchByName`, `stashBranch`, `bisect start`,
    and `git log` positional refs are one `rejectFlagLike`/`--end-of-options` sweep.
  - *`--json` contract hardening* — the inconsistent failure payloads, `doctor --json`,
    `getRepo`'s stdout write, and `--quiet` swallowing results are one contract fix.
  - *Cell-width correctness* — `cellWidth`'s range table, the seven `padEnd` surfaces, and
    `truncateCells`/`wrapCells` edge cases all resolve together, ideally by vendoring a real
    East-Asian-Width lookup.
  - *Unmount cleanup* — the four AbortController hooks plus the 5s commit timer are one
    `useEffect` pattern applied five times, best paired with a lint rule.
  - *Failure caching / retry* — issue-PR detail, blame, and file-history all cache failures
    and permanently disable retry via the same cache-skip guard.
  - *Mutually exclusive flags* — six unvalidated combinations, one `.check()` sweep per
    command builder.
  - *Dependency hygiene* — drop `@langchain/community` (22 MB, zero imports) and `p-queue`
    (zero imports) together with the semaphore consolidation, plus a CI check so it can't
    recur.
- **Low-severity findings** are best appended as checklists to the cluster issue for their
  area rather than filed standalone.

## Headline feature finding

`.kiro/specs/` holds two designed specs. One shipped; one did not:

| Spec | Status |
| --- | --- |
| `review-autofix-agent/` | **Complete** — all 15 tasks, including optional 11/12. `src/lib/autofix/**` with adapters for codex/claude/gemini all exist with tests. |
| `ai-conflict-resolution/` | **0 of 15 tasks.** `src/commands/resolve/` does not exist; `conflictResolve` never entered the `DynamicModelTask` union; `ProposalsSchema` has no `confidence` field; `conflictRegionActions.ts` has no conflict-marker guard on writes. |

The conflict spec names exact files and line numbers and sits on a fully working data layer
already shipped by #1369 — AI conflict resolution currently exists only inside `coco ui`,
with nothing for a user mid-rebase in a plain terminal or in CI. It is the single
highest-leverage item in the feature report, and it splits cleanly into about four PRs.
The missing marker guard is also a live correctness hazard in the *shipped* TUI path.

`feature-scoping.md` additionally derives two reference tables from the code that are worth
keeping current: a **forge capability × provider matrix** (all 25 `ForgeActions` methods × 4
facades, with file:line for every refusal) and a **provider registry coverage table**
(showing that OpenAI-compatible endpoints reached via `baseURL` silently inherit OpenAI's
token accounting, which *undercounts* and feeds straight into `enforcePromptBudget`).

## Full checklist

Titles are conventional-commit formatted and ready to use as issue titles. Suggested labels
in brackets.

### Critical

- [ ] `fix(workstation)`: pane widths can exceed terminal columns when the help overlay opens on a focused sidebar `[bug]`

### High

- [ ] `fix(config)`: `--ignoredFiles` / `--ignoredExtensions` wipe the default ignore list, exposing `.env` to the prompt `[bug, security]`
- [ ] `fix(config)`: `coco config set …apiKey --scope global` writes the key world-readable (0644) and non-atomically `[bug, security]`
- [ ] `fix(commit)`: `--split` apply resets the index up front and never restores staging for failed groups `[bug]`
- [ ] `fix(commit)`: `--split`'s "unclaimed" group silently unstages files and the CLI never says so `[bug]`
- [ ] `fix(cli)`: the default router drops global `--json` / `--quiet`, so `coco --commit --json` performs a real commit `[bug]`
- [ ] `fix(init)`: `--scope project` silently clobbers an existing `.coco.json`, dropping every unrelated key `[bug]`
- [ ] `fix(workstation)`: filesystem watcher is torn down and rebuilt after every worktree refresh `[bug, performance]`
- [ ] `fix(workstation)`: in-flight AI AbortControllers are never aborted on unmount, so `q` leaves the process hanging `[bug]`
- [ ] `fix(workstation)`: Esc during a PR-body draft gives no feedback and leaves the spinner running `[bug]`
- [ ] `fix(workstation)`: cellWidth mismeasures the exact status glyphs the UI renders `[bug]`
- [ ] `fix(workstation)`: seven surfaces still pad columns with padEnd instead of padCells, breaking CJK alignment `[bug]`
- [ ] `fix(workstation)`: command palette and theme picker hardcode 14 list rows and never clamp the window start `[bug]`
- [ ] `fix(git)`: route self-hosted Bitbucket Server remotes somewhere real instead of api.bitbucket.org `[bug]`
- [ ] `fix(git)`: stop routing forge URLs through `cmd /c start` on Windows `[bug, security]`
- [ ] `fix(git)`: filter Bitbucket pull requests by author/assignee server-side `[bug]`
- [ ] `fix(git)`: stop reporting API failures as "Empty response" in forge detail loaders `[bug]`
- [ ] `fix(git)`: guard unresolved project path in Bitbucket/Gitea forge mutations `[bug]`

### Medium

- [ ] `fix(cli)`: global `--quiet` swallows command *results*, not just chrome `[bug]`
- [ ] `fix(cli)`: `--json` failure payloads are inconsistent across commands `[bug]`
- [ ] `fix(cli)`: `getRepo` writes its failure to stdout, corrupting every `--json` consumer `[bug]`
- [ ] `fix(cli)`: mutually exclusive flags are silently resolved by precedence instead of validated `[bug]`
- [ ] `fix(doctor)`: `--json` is ignored for the main diagnostics report, which prints ANSI art to stdout `[bug]`
- [ ] `fix(review)`: `--pr <non-numeric>` becomes `NaN` and is passed straight to the forge `[bug]`
- [ ] `fix(review)`: a generation failure and a severity-gate breach both exit 1 — CI can't tell them apart `[bug]`
- [ ] `fix(review)`: `--comment` post failure is logged but the command still exits 0 `[bug]`
- [ ] `fix(commit)`: `--split` never validates group titles against commitlint `[bug]`
- [ ] `fix(commit)`: non-interactive hook failures print "fix the issues above" with the hook output muted `[bug]`
- [ ] `fix(commit)`: `--print-message` failures are completely silent and skip the missing-API-key hint `[bug]`
- [ ] `fix(git)`: every non-hook `GitError` is reported as "Commit blocked by pre-commit hook" `[bug]`
- [ ] `fix(changelog)`: `--write` section replacement swallows intervening `# ` release sections `[bug]`
- [ ] `fix(amend)`: `noVerify` from config is ignored (only the CLI flag is honored) `[bug]`
- [ ] `fix(config)`: the argv spread can clobber real config with `undefined` and shallow-replaces nested objects `[bug, tech-debt]`
- [ ] `perf(cache)`: the diff-summary cache rewrites the entire cache file on every write *and* every hit `[performance]`
- [ ] `refactor(parsers)`: three hand-rolled semaphores, while the declared `p-queue` dependency is never imported `[refactor, tech-debt]`
- [ ] `chore(deps)`: `@langchain/community` is a 22 MB production dependency that is never imported `[tech-debt]`
- [ ] `fix(langchain)`: the prompt-budget accept threshold and trim target disagree by `responseTokenReserve` `[bug]`
- [ ] `perf(langchain)`: the block-drop comparator re-tokenizes every block on each comparison `[performance]`
- [ ] `fix(workstation)`: split-plan `r` retry is unreachable from the error state the overlay advertises `[bug]`
- [ ] `fix(workstation)`: failed issue/PR detail fetches are dropped with no message and no retry `[bug]`
- [ ] `fix(workstation)`: failed blame / file-history results are cached, permanently disabling retry `[bug]`
- [ ] `fix(workstation)`: the 5s just-landed-commit timer is never cleared on unmount, so `q` lingers `[bug]`
- [ ] `fix(workstation)`: loadCommitContext can leave a permanent loading status when the append is deduplicated `[bug]`
- [ ] `fix(workstation)`: any open choice prompt bypasses the central confirmation gate for every workflow `[bug]`
- [ ] `fix(workstation)`: `truncateCells` silently drops the ellipsis at narrow budgets `[bug]`
- [ ] `fix(workstation)`: `wrapCells` returns unwrapped text when the budget is non-positive `[bug]`
- [ ] `fix(workstation)`: `useHistoryRefetch` re-runs on every `logArgv` identity change `[bug, performance]`
- [ ] `fix(git)`: stop swallowing gh failures as "No pull request found" `[bug]`
- [ ] `fix(git)`: guard flag-like refs in `checkoutBranchByName`, `stashBranch`, and `bisect start` `[bug]`
- [ ] `fix(git)`: pass `--end-of-options` before positional refs in `git log` `[bug]`
- [ ] `fix(git)`: resolve the tag remote instead of hardcoding origin `[bug]`
- [ ] `fix(git)`: don't drop a stash before the replacement store is known to succeed `[bug]`
- [ ] `fix(git)`: actually open the browser for Bitbucket/Gitea `pr create --web` `[bug]`
- [ ] `fix(git)`: paginate Gitea label lookup and distinguish "not found" from "lookup failed" `[bug]`
- [ ] `fix(git)`: make workspace PR counts host-aware (GHE regression) `[bug]`
- [ ] `fix(git)`: bound `git log --follow` in the file-history loader `[bug, performance]`
- [ ] `fix(git)`: surface truncated comment threads instead of silently degrading `[bug]`

### Low

- [ ] `fix(commit)`: `openInEditor` is declared as a commit option but has no yargs flag `[bug]`
- [ ] `fix(commit)`: `noResult` prints headings with no content unless `--verbose` `[bug]`
- [ ] `fix(commit)`: the split apply confirmation defaults to "yes" `[bug]`
- [ ] `fix(cli)`: numeric flags accept garbage and silently become `NaN` `[bug]`
- [ ] `fix(cli)`: `handleResult` is not awaited in changelog and recap `[bug]`
- [ ] `fix(recap)`: shortcut timeframe flags silently override an explicit `--timeframe` `[bug]`
- [ ] `fix(workspace)`: handler always `process.exit(0)`, masking failures and pending writes `[bug]`
- [ ] `fix(workstation)`: `openInEditor` does not pause Ink's stdin before spawning the editor `[bug]`
- [ ] `fix(workstation)`: `reword-head` rewrites HEAD without the confirmation `amend-head` requires `[bug]`
- [ ] `fix(workstation)`: workspace debug mode installs a SIGINT handler that suppresses Ctrl-C `[bug]`
- [ ] `fix(git)`: don't hijack process.stdout in the commit workflow `[tech-debt]`
- [ ] `fix(git)`: sanitize CI check names from forge payloads `[bug, security]`
- [ ] `fix(git)`: bound conflict-marker file reads `[performance]`
- [ ] `fix(git)`: use `--flag=value` (and guards) in gh list arg builders `[tech-debt]`
- [ ] `fix(git)`: verify Bitbucket reviewer PUT doesn't clobber PR fields `[bug]`
- [ ] `fix(langchain)`: `trimSummaryByBlocks` can return an over-budget prompt without throwing `[bug]`
- [ ] `fix(langchain)`: the "N files omitted" count undercounts dropped directories `[bug]`
- [ ] `fix(parsers)`: summarization failures are swallowed to `console.error`, bypassing the logger `[bug]`

### Feature proposals — P0

- [ ] `feat(resolve)`: ship the designed-but-unimplemented `coco resolve` CLI `[enhancement]` (L)
- [ ] `feat(forge)`: add draft→ready and PR reopen to the forge adapter `[enhancement]` (S)
- [ ] `feat(ci)`: gate the diff-condensing benchmark against the committed baseline `[enhancement, tech-debt]` (S)
- [ ] `feat(observability)`: dollar-denominated cost, per-model pricing, and budget caps `[enhancement]` (M)
- [ ] `feat(provider)`: use native structured output / JSON mode instead of parse-and-repair `[enhancement, performance]` (M)
- [ ] `feat(provider)`: first-class OpenAI-compatible provider presets `[enhancement]` (M)
- [ ] `feat(forge)`: fetch Bitbucket Cloud PR diffs instead of refusing `[enhancement]` (M)
- [ ] `feat(lint)`: audit and reword existing commit history against commitlint `[enhancement]` (M)
- [ ] `feat(distribution)`: official GitHub Action, pre-commit hook, and container image `[enhancement]` (M, file as 3)

### Feature proposals — P1

- [ ] `feat(forge)`: line-level review threads — read them, and post AI review as inline comments `[enhancement]` (L)
- [ ] `feat(forge)`: Azure DevOps provider `[enhancement]` (L)
- [ ] `feat(forge)`: Bitbucket Server / Data Center as a distinct provider `[enhancement]` (M)
- [ ] `feat(forge)`: CI checks surface with re-run and auto-merge `[enhancement]` (M)
- [ ] `feat(issues)`: create issues, and AI-draft them from a diff or a review finding `[enhancement]` (M)
- [ ] `feat(mcp)`: expose resources and prompts primitives, not just tools `[enhancement]` (M)
- [ ] `feat(mcp)`: progress notifications and streaming for long generations `[enhancement]` (M)
- [ ] `feat(workstation)`: mouse support (click-to-focus, wheel scroll, click-to-select) `[enhancement]` (M)
- [ ] `feat(workstation)`: undo stack for destructive git actions `[enhancement]` (M)
- [ ] `feat(blame)`: `coco blame --explain` `[enhancement]` (M)
- [ ] `feat(provider)`: promote prompt caching and reasoning effort to typed config `[enhancement]` (M)
- [ ] `feat(distribution)`: Scoop / winget / AUR / Nix packaging plus a stale-version notice `[enhancement]` (M)

### Feature proposals — P2

- [ ] `feat(stack)`: stacked-branch / stacked-PR support `[enhancement]` (L)
- [ ] `feat(watch)`: `coco watch` — continuous review and commit-draft daemon `[enhancement]` (M)
- [ ] `feat(workstation)`: `git notes` and sparse-checkout awareness `[enhancement]` (M)
- [ ] `feat(forge)`: CODEOWNERS awareness and required-reviewer surfacing `[enhancement]` (M)
- [ ] `feat(i18n)`: take `language` beyond a one-sentence prompt hint `[enhancement]` (M, file as 2)
- [ ] `feat(agent)`: read `AGENTS.md` / steering files as a first-class context source `[enhancement]` (S)
- [ ] `feat(observability)`: report diff-summary cache hit rate in `doctor --cost` `[enhancement]` (S)

## Confidence and verification

Each finding carries an explicit confidence level. The distribution:

- **high** — the large majority; verified against quoted code, and in several cases
  reproduced by executing the real exported function (pane-width overflow, `cellWidth`
  glyph measurement, `padEnd` vs `padCells` cell counts, the `loadConfig` ignore-list
  collapse and argv clobber, yargs argv shapes for the flag-contract findings).
- **medium** — one item: the Windows `cmd /c start` injection, which needs a Windows host to
  confirm Node's quoting of a space-free `&` argument.
- **needs-verification** — six items, each stating the exact check that would settle it.
  These should be confirmed before filing, or filed with the open question stated.

Nothing in this audit changed any source file. Every claim cites `path:line` so it can be
re-checked independently.
