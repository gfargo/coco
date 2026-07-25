# Bug audit — `src/git/**` (coco v0.84.1)

Read-only audit. No code changed. Every claim below is quoted from the file at the cited line.

Scope covered: git read/write actions (`logData`, `historyActions`, `branchActions`, `statusActions`,
`statusHunks`, `stash*`, `tag*`, `worktree*`, `reflog*`, `bisect*`, `blame*`, `submodule*`,
`operation*`, `conflictRegionActions`, `rebase*`, `hunkActions`, `compareData`, `fileHistoryData`,
`workspace*`, `cloneRepo`, `gitignore`, `repoIdentifier`) and the multi-forge adapter
(`forgeActions`, `forgeLoad`, `forgeErrors`, `forgeText`, `forgeArgGuards`, `githubCli`, `glabCli`,
`bitbucketCli`, `giteaCli`, and all `*ListData` / `*DetailData` / `*Actions` per-forge modules).

---

## HIGH

### [SEVERITY: high] fix(git): route self-hosted Bitbucket Server remotes somewhere real instead of api.bitbucket.org
**File:** src/git/bitbucketCli.ts:40,76 (with src/git/providerData.ts:115)
**What's wrong:** `detectProvider` classifies **any** host containing `bitbucket` as the `bitbucket`
provider, and `forgeHostOverrides` lets a user map an arbitrary vanity host to `bitbucket`. But the
Bitbucket runner has a single hardcoded cloud API base and never consults the parsed host —
`BitbucketProject.host` is populated by `resolveForgeProject` and then discarded. Bitbucket
Server/Data Center serves a completely different API (`/rest/api/1.0/...`), so every call for a
self-hosted remote is sent to Atlassian's cloud with a workspace slug that doesn't exist there.
`getForgeActions` has `gitlabHost` and `giteaHost` options but no `bitbucketHost`.
**Evidence:**
```ts
// providerData.ts:115
if (h === 'bitbucket.org' || h.includes('bitbucket')) return 'bitbucket'
// bitbucketCli.ts:40,76
export const BITBUCKET_API_BASE = 'https://api.bitbucket.org/2.0'
const url = endpoint.startsWith('http') ? endpoint : `${BITBUCKET_API_BASE}/${endpoint}`
```
**Impact:** On `bitbucket.acme.com`, `coco prs` / `coco issues` / every PR mutation hits
`https://api.bitbucket.org/2.0/repositories/<ws>/<repo>/...`. Users see "Bitbucket credentials are
invalid" or a 404 body, or — worse — if a same-named workspace exists on Bitbucket Cloud, they act on
the **wrong repository**. Reproduce: point `origin` at any `*bitbucket*` host that is not
`bitbucket.org` and run `coco prs`. No test exercises the non-`bitbucket.org` branch
(`bitbucketCli.test.ts` and `providerData.test.ts` only assert `bitbucket.org`).
**Suggested fix:** Thread `project.host` into the runner (`makeBitbucketRunner(host)` mirroring
`makeGiteaRunner`), and gate non-`bitbucket.org` hosts behind an explicit "Bitbucket Server is not
supported" message rather than silently addressing the cloud API.
**Confidence:** high

### [SEVERITY: high] fix(git): stop routing forge URLs through `cmd /c start` on Windows
**File:** src/git/historyActions.ts:112 (reached from src/git/providerActions.ts:19)
**What's wrong:** `defaultOpenUrlRunner` opens URLs on Windows via `execFile('cmd', ['/c','start','',url])`.
`execFile` does not use a shell, but `cmd.exe` *is* the shell here and parses its own command line, so
shell metacharacters in `url` (`&`, `|`, `^`, `>`) are interpreted by cmd. Node only adds quoting for
args containing spaces/tabs/quotes, so a URL with `&` and no space is passed unquoted. The URL is
built from remote-derived data: `buildProviderUrl` percent-encodes only the *ref* portion, while the
base is `https://${parsed.host}/${parsed.owner}/${parsed.name}` straight out of `.git/config` with no
character validation in `parseRemoteUrl`.
**Evidence:**
```ts
// historyActions.ts:110-113
if (process.platform === 'win32') {
  await runCommand('cmd', ['/c', 'start', '', url])
  return
}
```
```ts
// providerData.ts:158 — webUrl is unvalidated remote text
webUrl: `https://${parsed.host}/${parsed.owner}/${parsed.name}`,
```
**Impact:** On Windows, a repo whose remote URL contains `&calc` (or any command) executes it when the
user presses the open-in-browser key. Reproduce: `git remote set-url origin https://example.com/a&calc/b`,
open the branches/history view on Windows, trigger `open-provider-url`.
**Suggested fix:** Use `spawn('rundll32', ['url.dll,FileProtocolHandler', url])` or
`powershell -NoProfile -Command Start-Process -- <url>` with argv separation, and validate that the
resolved URL parses as `http(s)` with a hostname before handing it to any launcher.
**Confidence:** medium — the injection path is standard-known for `cmd /c start`; a Windows box is
needed to confirm Node's exact quoting for a `&`-containing, space-free argument.

### [SEVERITY: high] fix(git): filter Bitbucket pull requests by author/assignee server-side
**File:** src/git/bitbucketListData.ts:231-250
**What's wrong:** The Bitbucket **issue** loader was explicitly fixed to resolve `@me` and push the
filter into the BBQL query *before* fetching (see its own comment at line 338-343). The **pull
request** loader still fetches `want` (default 30) PRs unfiltered and then filters in memory, even
though BBQL supports `author.nickname` and `reviewers.nickname`.
**Evidence:**
```ts
// bitbucketListData.ts:239-248
if (filter.author) {
  const authorFilter = filter.author === '@me' ? me : filter.author
  pullRequests = pullRequests.filter((pr) => pr.author === authorFilter)
}
if (filter.assignee) { ... pr.assignees?.includes(assigneeFilter) ... }
```
vs. the sibling issue path, whose comment states the exact bug: *"Filtering after the fetch (the old
approach) ran against only the first `want` issues of the unfiltered list, so a user whose issues sat
past that window saw them silently dropped."*
**Impact:** `coco prs --author @me` on a busy Bitbucket repo silently returns an empty or partial list
whenever the user's PRs are older than the newest 30. Same for `--assignee`. Reproduce: repo with 40+
open PRs where yours are #1-#5.
**Test note:** `bitbucketListData.test.ts:354-400` encodes the buggy behavior — the fixtures contain
only two PRs, so post-fetch filtering passes; the issue-list tests at 448-470 assert the correct
server-side form (`reporter.nickname = "erin"` in the endpoint).
**Suggested fix:** Extend `buildPullRequestEndpoint` with `author.nickname = "…"` /
`reviewers.nickname = "…"` clauses (already have `bbqlQuote`), matching `buildIssueEndpoint`.
**Confidence:** high

### [SEVERITY: high] fix(git): stop reporting API failures as "Empty response" in forge detail loaders
**File:** src/git/bitbucketDetailData.ts:55-62,146; src/git/gitlabDetailData.ts:79-84,150; src/git/giteaDetailData.ts:55-62
**What's wrong:** All three non-GitHub detail loaders fetch the primary object through a `safeJson`
helper that catches **every** error and returns `undefined`; the caller then reports "Empty response".
A 401, 403, 404, DNS failure, or timeout is therefore indistinguishable from an empty body, and the
underlying stderr/status is thrown away.
**Evidence:**
```ts
// bitbucketDetailData.ts:55-62 (gitlab/gitea identical)
async function safeJson<T>(runner: BitbucketRunner, endpoint: string): Promise<T | undefined> {
  try { const out = (await runner(endpoint)).trim(); return out ? (JSON.parse(out) as T) : undefined }
  catch { return undefined }
}
```
```ts
// bitbucketDetailData.ts:146
return { ok: false, message: `Empty response from Bitbucket for pull request #${pullRequestNumber}` }
```
**Impact:** A user whose token expired mid-session sees "Empty response from Bitbucket for pull
request #12" in the inspector instead of the auth hint the forge layer already knows how to produce
(`describeBitbucketStatus`). Every diagnosis path (wrong workspace, private repo, offline) collapses
into one wrong message. Reproduce: unset `BITBUCKET_ACCESS_TOKEN` mid-run, or point at a PR number
that doesn't exist.
**Suggested fix:** Let the primary-object fetch throw and route it through
`resolveBitbucketActionError` / `resolveGlabActionError` / `resolveGiteaActionError` (which already
re-probe auth); keep `safeJson` only for the genuinely optional sub-resources (approvals, statuses).
**Confidence:** high

### [SEVERITY: high] fix(git): guard unresolved project path in Bitbucket/Gitea forge mutations
**File:** src/git/forgeActions.ts:281-302, 330-352
**What's wrong:** In the Bitbucket and Gitea facades the *detail* methods guard a missing project path
and return `{ ok: false, message: 'No … project resolved' }`, but every by-number mutation and every
issue mutation coerces with `path ?? ''`, producing endpoints with an empty path segment. The Gitea
facade additionally builds its runner with `makeGiteaRunner(host ?? '')`, i.e. base `https:///api/v1`
when the host is unknown.
**Evidence:**
```ts
// forgeActions.ts:284-285,298-302
mergePullRequestByNumber: (n, strategy) => mergeBitbucketPullRequestByNumber(path ?? '', n, strategy),
requestChangesPullRequestByNumber: (n, body) => requestChangesBitbucketPullRequestByNumber(path ?? '', n, body),
commentIssue: (n, body) => commentBitbucketIssue(path ?? '', n, body),
closeIssue: (n) => closeBitbucketIssue(path ?? '', n),
// forgeActions.ts:319
const runner = makeGiteaRunner(host ?? '')
```
**Impact:** With an unresolvable remote the user gets an HTTP 404 body or a `Failed to parse URL`
network error (further masked by the auth re-probe into "Set GITEA_TOKEN"), instead of the clear "No
project resolved" message the detail path returns for the identical precondition. Reproduce:
`getForgeActions('bitbucket', {})` then `mergePullRequestByNumber(1, 'merge')` → request to
`repositories//pullrequests/1/merge`.
**Suggested fix:** Hoist one `if (!path) return { ok:false, message:'No … project resolved' }` guard
(and a host guard for Gitea) shared by every method in the facade.
**Confidence:** high

---

## MEDIUM

### [SEVERITY: medium] fix(git): stop swallowing gh failures as "No pull request found"
**File:** src/git/pullRequestData.ts:167-176
**What's wrong:** The GitHub current-branch overview wraps `gh pr view` in a bare `catch` that
discards the error and always reports "No pull request found for \<branch\>". Rate limits, network
failures, a gh crash, a repo the token can't see, and a genuinely PR-less branch are reported
identically. Every other forge lets the error reach `loadForgeOverview`, which surfaces
`error.message`.
**Evidence:**
```ts
// pullRequestData.ts:168-175
try {
  const output = await runner(['pr', 'view', '--json', PULL_REQUEST_VIEW_JSON_FIELDS])
  return { currentPullRequest: parsePullRequestInfo(output) }
} catch {
  return { message: currentBranch ? `No pull request found for ${currentBranch}.` : 'No current branch.' }
}
```
**Impact:** Offline or rate-limited users are told their PR doesn't exist. Reproduce: set an invalid
`GH_TOKEN` after the auth probe passes, or run with the network down.
**Suggested fix:** Inspect the error — only map gh's "no pull requests found" to the friendly message
and let anything else fall through to `compactGhError` (already available).
**Confidence:** high

### [SEVERITY: medium] fix(git): guard flag-like branch name in checkoutBranchByName
**File:** src/git/branchActions.ts:117-121
**What's wrong:** Its siblings in the same file (`createBranch:104`, `renameBranch:129`,
`setUpstream:373`) all call `rejectFlagLike` before handing a user-typed name to git.
`checkoutBranchByName` — which receives free-typed input from the create-branch-here confirm prompt —
does not, and there is no `--end-of-options` / `--` separator.
**Evidence:**
```ts
export function checkoutBranchByName(git: SimpleGit, name: string): Promise<BranchActionResult> {
  const trimmed = name.trim()
  if (!trimmed) return Promise.resolve({ ok: false, message: 'Branch name required' })
  return runAction(() => git.raw(['switch', trimmed]), `Checked out ${trimmed}`)
}
```
**Impact:** A typed value beginning with `-` is parsed by `git switch` as an option — e.g. `--detach`
detaches HEAD, `-c foo` creates a branch — while the result message claims "Checked out \<value\>".
Not remote-code-execution (no shell), but it silently performs a different git operation than the one
named.
**Suggested fix:** `rejectFlagLike(trimmed, …)` like its siblings, and/or `['switch', '--', trimmed]`.
**Confidence:** high

### [SEVERITY: medium] fix(git): guard flag-like branch name in stashBranch
**File:** src/git/stashActions.ts:96-105
**What's wrong:** Same asymmetry as above: `historyActions.createBranchFromCommit` and
`branchActions.createBranch` guard user-typed branch names; `stash branch <name>` does not.
**Evidence:**
```ts
const trimmed = branchName.trim()
if (!trimmed) return Promise.resolve({ ok: false, message: 'Cancelled: empty branch name.' })
return runAction(() => git.raw(['stash', 'branch', trimmed, stash.ref]), …)
```
**Impact:** A leading-`-` name is consumed as a `git stash branch` option; the action reports success
for an operation that didn't happen as described.
**Suggested fix:** Add `rejectFlagLike`.
**Confidence:** high

### [SEVERITY: medium] fix(git): guard bisect start refs
**File:** src/git/bisectActions.ts:17-40
**What's wrong:** `bisectStart` (and the optional `ref` on good/bad/skip) passes refs positionally with
no leading-dash guard and no `--`. `git bisect start` accepts options such as `--term-new` /
`--term-old` / `--no-checkout` in exactly that position.
**Evidence:**
```ts
export async function bisectStart(git: SimpleGit, badRef: string, goodRef: string): Promise<string> {
  return git.raw(['bisect', 'start', badRef, goodRef])
}
```
**Impact:** A mistyped/pasted ref starting with `-` starts a bisect with altered semantics (or errors
opaquely) rather than being rejected up front. Also note `bisectRun` intentionally shells through
`sh -c` (documented); that is by design for user-supplied test commands, but it means the bisect
surface is the one place in `src/git` where a shell is involved — worth an explicit confirm gate.
**Suggested fix:** `rejectFlagLike` both refs (the helper already exists and is used by
`rebaseActions.rebaseOnto` for the same shape of input).
**Confidence:** high

### [SEVERITY: medium] fix(git): resolve the tag remote instead of hardcoding origin
**File:** src/git/tagActions.ts:49-66
**What's wrong:** `pushTag` and `deleteRemoteTag` hardcode `origin`, while the rest of the layer
resolves "origin, else the first remote" through `resolveDefaultRemote` (githubCli.ts:126) or
`branchActions.resolveDefaultRemote` (branchActions.ts:60).
**Evidence:**
```ts
() => git.raw(['push', 'origin', `refs/tags/${tagName}`]),
…
() => git.raw(['push', 'origin', `:refs/tags/${tagName}`]),
```
**Impact:** In a repo whose only remote is `upstream` (fork workflows, `git remote rename`), tag
push/delete fails with git's raw "'origin' does not appear to be a git repository" instead of using
the single configured remote. `tagActions.test.ts:26-27` locks the hardcoded `origin` in.
**Suggested fix:** Reuse the shared default-remote resolver and surface "no remote configured" when
there is none.
**Confidence:** high

### [SEVERITY: medium] fix(git): don't drop a stash before the replacement store is known to succeed
**File:** src/git/stashActions.ts:136-140
**What's wrong:** `renameStash` drops the reflog entry first and then re-stores the commit under the
new message (the ordering is deliberate and documented). But if the `store` fails, the entry is gone
and the returned message contains only git's `store` error — not the commit hash needed to recover.
**Evidence:**
```ts
return runAction(async () => {
  await git.raw(['stash', 'drop', stash.ref])
  await git.raw(['stash', 'store', '-m', storedMessage, stash.hash])
}, `Renamed ${stash.ref} → ${trimmed}`)
```
**Impact:** A failed rename removes the stash from the list; the work is only recoverable via
`git fsck`/reflog spelunking because the UI never shows `stash.hash`. Reproduce: make `stash store`
fail (e.g. concurrent stash mutation, read-only `.git`).
**Suggested fix:** Wrap the pair so a failed `store` retries or, at minimum, include
`stash.hash` in the failure `details` (`git stash store -m … <hash>` is then a copy-paste recovery).
**Confidence:** high

### [SEVERITY: medium] fix(git): actually open the browser for Bitbucket/Gitea `pr create --web`
**File:** src/git/bitbucketPullRequestActions.ts:55-57; src/git/giteaPullRequestActions.ts:56-58
**What's wrong:** GitHub and GitLab implement `openPullRequest` by invoking the CLI's `--web`
(`['pr','view','--web']` / `['mr','view','--web']`). Bitbucket and Gitea return `ok: true` without
opening anything, even though the repo already has a cross-platform opener
(`historyActions.defaultOpenUrlRunner`, used by `providerActions.openProviderUrl`).
**Evidence:**
```ts
export function openBitbucketPullRequest(url: string): PullRequestActionResult {
  return { ok: true, message: `Open this URL in your browser: ${url}`, url }
}
```
**Impact:** `coco pr create --web` on Bitbucket/Gitea reports success and no browser opens
(handler: `src/commands/prCreate/handler.ts:178`). Parity gap the facade's own capability table doesn't
record as unsupported (unlike checkout/diff, which return `ok: false`).
**Suggested fix:** Call `defaultOpenUrlRunner(url)` (with the Windows fix above) and return its
result, or return `ok: false` so the CLI reports the gap honestly.
**Confidence:** high

### [SEVERITY: medium] fix(git): paginate Gitea label lookup and distinguish "not found" from "lookup failed"
**File:** src/git/giteaPullRequestActions.ts:143-176
**What's wrong:** `resolveGiteaLabelId` requests only the first 50 repo labels and swallows any error
into `undefined`; the caller then reports a definitive "not found — create it in Gitea first".
Org-level labels are not in the repo label list at all.
**Evidence:**
```ts
const out = (await runner(`repos/${projectPath}/labels?limit=50`)).trim()
const labels = out ? (JSON.parse(out) as Array<{ id?: number; name?: string }>) : []
return labels.find((l) => l.name === label)?.id
} catch { return undefined }
```
```ts
if (id === undefined) {
  return { ok: false, message: `Label '${label}' not found on this repository. Create it in Gitea first.` }
}
```
**Impact:** On repos with >50 labels (or any transient API error), adding an existing label fails with
advice to create a label that already exists — and following that advice creates a duplicate.
**Suggested fix:** Page through `/labels` with the shared `paginate` helper (already imported
elsewhere in the Gitea modules), include `/orgs/{org}/labels`, and separate the throw path from the
not-found path.
**Confidence:** high

### [SEVERITY: medium] fix(git): make workspace PR counts host-aware (GHE regression)
**File:** src/git/workspacePullRequestData.ts:185,208
**What's wrong:** The workspace surface probes auth with the github.com default
(`isGhAuthenticated(runner)` → `getGhStatus(runner, 'github.com')`) and resolves repos with the
github.com-only `parseGitHubRemoteUrl`. The rest of the layer was migrated to host-aware resolution
for exactly this reason (`getGitHubRepositoryForGit`, "#1609" in `issuesListData.ts:135`).
**Evidence:**
```ts
const authenticated = await isGhAuthenticated(runner)   // github.com only
…
const repo = parseGitHubRemoteUrl(url)                   // returns undefined for GHE hosts
```
**Impact:** A workspace of GitHub Enterprise repos shows no PR badges at all, and a user authenticated
only to a GHE host gets `authenticated: false` (whole column dropped). Reproduce: workspace root with
GHE remotes only.
**Suggested fix:** Parse with the host-agnostic `parseRemoteUrl` + `detectProvider`, probe
`getGhStatus(runner, host)`, and pass `-R <webUrl>` (the same trick `providerData.getDefaultBranch`
uses at line 267-270) instead of a bare `owner/name` slug.
**Confidence:** high

### [SEVERITY: medium] fix(git): bound `git log --follow` in the file-history loader
**File:** src/git/fileHistoryData.ts:86-99
**What's wrong:** Unlike `logData.buildLogArgs` (which always sets `--max-count`), the file-history
loader runs an unbounded `git log --follow` and buffers the whole result. `--follow` on an old file in
a large repo can walk the entire history.
**Evidence:**
```ts
output = await git.raw([
  'log', '--follow', `--format=%H${SEP}%h${SEP}%an${SEP}%at${SEP}%s${REC}`, '--', path,
])
```
**Impact:** Opening file history for a long-lived file blocks the TUI for seconds and buffers the full
log into memory; there is no `--max-count`, no timeout, and no AbortSignal, so the keystroke cannot be
cancelled. Same shape applies to `blameData.getBlame` (`git blame --porcelain` on a huge file).
**Suggested fix:** Add `--max-count=<limit>` (mirroring `LOG_DEFAULT_LIMIT`) with a "load more" path,
and thread an AbortSignal.
**Confidence:** high

### [SEVERITY: medium] fix(git): surface truncated comment threads instead of silently degrading
**File:** src/git/gitlabDetailData.ts:60-84; src/git/bitbucketDetailData.ts:64-82; src/git/giteaDetailData.ts:65-83
**What's wrong:** All three comment loaders call `paginate({ want: Infinity, maxPages: 20, onError: 'stop' })`.
`onError: 'stop'` discards a mid-pagination error and returns the partial list; the 20-page cap
silently truncates long threads. Nothing in the returned `PullRequestDetail` records that the list is
incomplete.
**Evidence:**
```ts
// gitlabDetailData.ts:70-83
parsePage: (output) => { if (!output) return undefined … },
want: Infinity, maxPages: 20, onError: 'stop',
```
**Impact:** The inspector shows a truncated discussion (up to 2000 GitLab notes / 1000 Bitbucket
comments, then nothing) and a failed page 3 renders as "the thread ended at page 2" — a reviewer can
miss a change request. Reproduce: a PR with >1000 comments, or make the second page 500.
**Suggested fix:** Return `{ items, truncated: boolean }` from the pagination and render a
"… N more comments (fetch failed / limit reached)" row.
**Confidence:** high

### [SEVERITY: medium] fix(git): pass `--end-of-options` before positional refs in `git log`
**File:** src/git/logData.ts:400-418
**What's wrong:** `buildLogArgs` appends `argv.branch` and `options.extraRefs` as bare positionals,
with `--` only added when `argv.path` is non-empty. The repo already knows the right pattern — it uses
`--end-of-options` exactly once, in `src/operations/agent/context.ts:179`.
**Evidence:**
```ts
} else if (argv.branch) {
  args.push(argv.branch)
}
…
if (options.extraRefs && options.extraRefs.length > 0) {
  args.push(...options.extraRefs)
}
```
**Impact:** `coco log --branch <value-starting-with-dash>` (or a stash hash list that ever contains a
non-hash) makes git reinterpret the value as an option; and a branch name that collides with a file
name produces git's ambiguity error instead of the intended log. Lower severity than the mutating
paths because `git log` is read-only.
**Suggested fix:** Insert `--end-of-options` before the first positional ref (git ≥ 2.24) and keep the
existing `--` for pathspecs.
**Confidence:** high

---

## LOW

### [SEVERITY: low] fix(git): don't hijack process.stdout in the commit workflow
**File:** src/git/commitWorkflowActions.ts:141-152
**What's wrong:** `runCommitWorkflow` replaces the global `process.stdout.write` for the duration of
the commit handler and treats everything captured as the commit message. Anything else that writes to
stdout during that window (Ink frame renders, a logger that isn't silenced, another concurrent
workflow) is swallowed into `output` and can end up in the commit message.
**Evidence:**
```ts
process.stdout.write = ((chunk: string | Uint8Array, ...args: unknown[]) => {
  output += typeof chunk === 'string' ? chunk : chunk.toString()
  …
}) as typeof process.stdout.write
…
if (action === 'commit' && message) { await createCommit(message, git, …) }
```
**Impact:** Latent rather than live: `runCommitWorkflow` is referenced only by
`commitWorkflowActions.test.ts` — the TUI uses `runCommitDraftWorkflow`, which has no stdout capture.
Wiring this function into any Ink surface would commit captured render output.
**Suggested fix:** Have the commit handler return its text (as `generateCommitDraft` already does)
instead of capturing global stdout; or delete the unused function.
**Confidence:** high (the hazard and the fact that it is currently unreferenced in production are
both verified)

### [SEVERITY: low] fix(git): sanitize CI check names from forge payloads
**File:** src/git/forgeText.ts:100-113
**What's wrong:** `sanitizePullRequestDetail` strips control bytes from body, comments, and review
author/body, but not from `statusCheckRollup[].name` / `.status` / `.conclusion`. Check names are
attacker-influenced (they come from a workflow file in the PR's own branch on GitHub, or a build
status POST on Bitbucket/Gitea).
**Evidence:**
```ts
export function sanitizePullRequestDetail(detail: PullRequestDetail): PullRequestDetail {
  return { ...detail, body: stripControlMultiline(detail.body),
    comments: detail.comments.map(sanitizeComment),
    reviews: detail.reviews.map((review) => ({ …clean(review.author), body: stripControlMultiline(review.body) })),
  }
}
```
(`statusCheckRollup` is spread through untouched; the same is true of
`sanitizePullRequestInfo`, which also omits `statusCheckRollup` and `reviews`.)
**Impact:** A check named with ANSI/OSC sequences can wipe scrollback, spoof a "✓ approved" row, or
drive OSC 52 in the inspector — precisely the threat model the module's own docblock describes.
**Suggested fix:** Map `statusCheckRollup` (and `PullRequestInfo.reviews`) through `stripControl`.
**Confidence:** high

### [SEVERITY: low] fix(git): bound conflict-marker file reads
**File:** src/git/operationData.ts:131-150
**What's wrong:** `getConflictMarkers` reads each conflicted file fully into memory with
`readFileSync(filePath, 'utf8')` and splits it, only checking the 12-marker limit *between* files.
**Evidence:**
```ts
markers.push(...parseConflictMarkers(file.path, readFileSync(filePath, 'utf8')))
```
**Impact:** A conflicted large binary-ish or generated file (lockfiles, minified bundles) is fully
read and line-split on every operation-overview refresh.
**Suggested fix:** Skip files above a size threshold (`statSync`), or stream line-by-line and stop at
the marker limit.
**Confidence:** high

### [SEVERITY: low] fix(git): use `--flag=value` (and guards) in gh list arg builders
**File:** src/git/pullRequestListData.ts:140-152; src/git/issuesListData.ts:117-127
**What's wrong:** `forgeArgGuards.ts:2-9` documents the layer-wide invariant that *"Action builders
pass values as `--flag=value` (so flag injection is already neutralized)"*. The two gh **list**
builders use the space-separated form and apply none of the guards, and `parsePullRequestListItems` /
`parseIssueListItems` call `JSON.parse` on gh's stdout with no try/catch — the throw is caught by
`loadForgeList`, which surfaces the raw `Unexpected token …` string to the user.
**Evidence:**
```ts
if (filter.state) args.push('--state', filter.state)
if (filter.assignee) args.push('--assignee', filter.assignee)
…
const raw = JSON.parse(trimmed) as Array<Record<string, unknown>>
```
**Impact:** Mostly a consistency/robustness gap — Go's flag parser consumes the following token as the
value even when it starts with `-`, so the injection risk is small; the user-visible defect is that any
non-JSON stdout (a gh deprecation notice, a truncated stream) produces a JSON parser error instead of
"GitHub CLI returned unexpected output".
**Suggested fix:** Switch to `--flag=value` to match every other builder, and wrap the parse with a
"unexpected gh output" message that includes the first line of stdout.
**Confidence:** high

### [SEVERITY: low] fix(git): verify Bitbucket reviewer PUT doesn't clobber PR fields
**File:** src/git/bitbucketPullRequestActions.ts:181-190
**What's wrong:** Adding a reviewer issues `PUT /repositories/{path}/pullrequests/{id}` with a body
containing **only** `reviewers`. Bitbucket's PR update endpoint documents `title` as required and
behaves as a merge-update; if any field is treated as absent-means-clear, the PR's title/description
could be affected.
**Evidence:**
```ts
return runBitbucketAction(runner, `repositories/${projectPath}/pullrequests/${pullRequestNumber}`,
  'PUT', { reviewers: [...currentReviewers, { account_id: accountId }] }, …)
```
**Impact:** Potential silent mutation of PR title/description when assigning a reviewer.
**Suggested fix:** Fetch the PR first (the function already does, for `reviewers`) and echo `title`
(and `description`) back in the PUT body.
**Confidence:** needs-verification — confirm against a live Bitbucket Cloud PR whether a
`reviewers`-only PUT returns 400 or blanks `title`/`description`. The existing test
(`bitbucketPullRequestActions.test.ts`) only asserts the request shape, so it would not catch either
outcome.

---

## Areas I checked and found clean

- **No shell anywhere in the git layer except by design.** `grep` for `shell: true`, `execSync`, and
  string-concatenated commands across `src/git/**` returns nothing. All process launches are
  `execFile`/`spawn` with array argv (`githubCli.ts:113`, `glabCli.ts:47`, `rebasePlanActions.ts:156`,
  `statusHunks.ts:71`, `historyActions.ts:52,70`). The one deliberate shell is
  `bisectActions.bisectRun` (`git bisect run sh -c <cmd>`), documented as the user's own test command.
- **`rebasePlanActions` editor plumbing.** `GIT_SEQUENCE_EDITOR: cp '<todoFile>'` and the reword
  `-F '<file>'` paths are single-quoted, the temp dir comes from `mkdtempSync`, and the env override is
  scoped to the spawned process rather than mutating the shared SimpleGit instance. Mid-run stops are
  detected from repo state, not localized stderr text (`#1688`) — correct.
- **Porcelain/NUL parsing.** `statusData.parsePorcelainStatus`, `operationData.parseConflictedFiles`,
  and `logData.parseNumstat`/`parseNameStatus` all use `-z` and correctly consume the extra origin-path
  token for `R`/`C` records, so `core.quotePath` and paths with spaces/quotes/newlines round-trip.
  `expandCollapsedRename` covers the brace form (`#1707`).
- **Diff-header path extraction** (`stashData.resolveDiffGitHeaderPath` + `unescapeGitQuoted`): the
  quoted/unquoted-per-side handling, the octal-escape single-pass decoder, and the length-halving
  fallback are all correct, including the `a\\tb` case the comment calls out.
- **Conflict-marker parsing** (`conflictRegionActions`): exactly-seven-character marker regexes
  (`#1395`) prevent setext underlines from flipping sections; diff3 base handling, unterminated-region
  bail-out, content-identity matching before write, path containment check against the worktree root,
  and atomic tmp+rename write are all sound.
- **Ours/theirs inversion during rebase** (`operationActions.resolveConflictKeepCurrentBranch`) is
  handled correctly — this is the single most commonly-wrong thing in a git TUI.
- **Empty-repo / unborn-HEAD handling**: `logData.getLogRows` retries through `isEmptyRepo` rather
  than matching localized git strings (`#1708`); `workspaceData.getRepoSummary` and
  `providerData.detectLocalDefaultBranch` both degrade cleanly with no commits.
- **Detached HEAD**: `workspaceData` falls back to `rev-parse --short HEAD`;
  `forgeLoad.loadForgeOverview` short-circuits with "No current branch." for GitLab/Bitbucket/Gitea;
  Bitbucket/Gitea current-branch mutations return "No current branch (detached HEAD?)".
- **Divergence math**: both `parseDivergence` implementations (`branchData.ts:78`,
  `workspaceData.ts:284`) map `rev-list --left-right --count <upstream>...<branch>` to
  behind/ahead in the right order.
- **Timeouts / buffers / cancellation on the gh and glab runners**: `GH_DEFAULT_TIMEOUT_MS`,
  `GH_MAX_BUFFER_BYTES` (16 MB, deliberately above execFile's 1 MB default), and optional
  `AbortSignal` are wired in both (`githubCli.ts:113`, `glabCli.ts:47`); the REST runners use
  `AbortSignal.timeout`. `workspacePullRequestData.runGhWithTimeout` correctly aborts and clears its
  timer.
- **Secret handling**: no token is ever interpolated into a URL or an error message. Bitbucket/Gitea
  credentials go into an `Authorization` header only (`bitbucketCli.ts:47-58`, `giteaCli.ts:44-47`);
  `compactCliError` strips the echoed `Command failed:` argv line, which is what would otherwise leak
  a `--body` payload into a notification.
- **`cloneRepo.validateCloneUrl`** correctly rejects leading-dash remotes, `ext::`/`file::` transport
  helpers, and non-allowlisted schemes — the strongest guard in the layer.
- **`glab` verb/flag contract**: `glabCompat.test.ts` live-checks `mr create/merge/note create/update`
  and `issue note/update` flags against the installed binary. I verified against the
  [glab `issue note` docs](https://docs.gitlab.com/cli/issue/note/) and the
  [MR that introduced `mr note create`](https://gitlab.com/gitlab-org/cli/-/merge_requests/3099/reports)
  that coco's asymmetric use of `mr note create` vs `issue note` is currently correct, not a bug.
  (Content was rephrased for compliance with licensing restrictions.)
- **GitLab `iid` vs `id`**: every GitLab mapping uses `iid` (`gitlabListData.ts:174,247,313`), and the
  Gitea mappings use `number` while Bitbucket uses `id` — all correct for their APIs.
- **GHE host awareness on the main GitHub paths**: `getGitHubRepositoryForGit`,
  `getGhStatus(runner, repository.host)`, and the `gh repo view <webUrl>` full-URL form
  (`providerData.ts:263-275`) are all correct; the only remaining github.com-only path is the
  workspace PR-count fetcher reported above.
- **`simple-git` `revparse` trimming**: verified in `node_modules/simple-git/dist/cjs/index.js:4644`
  that `revparse` uses `straightThroughStringTask(commands, true)` (trimmed), so the untrimmed-looking
  `statusHunks.applyPatch` `cwd` is not a bug.
- **`statusHunks` line-staging math** (`sliceHunkLines`) — the stage vs discard neutralization rules
  and the recount of `oldLines`/`newLines` match `git add -p`'s edit semantics; the EPIPE listener on
  `child.stdin` (`#1639`) is correctly placed.
- **Batch-order hazards**: `dropStashes` sorts descending by `stash@{N}` (renumbering-safe) and
  `deleteBranches` continues past per-item refusals while preserving git's raw wording for the
  force-delete escalation match.
