# Bug audit — `src/lib/**` (coco v0.84.1)

Read-only audit. No code changed. Every claim below is quoted from the file at the cited
line, and the four findings marked **(verified empirically)** were confirmed by executing
the real exported functions via `npx tsx` (probe files deleted; `git status` left clean).

None of these are caught by the existing gate: `npx tsc --noEmit` is clean, `npx eslint src
bin e2e` reports 42 problems that are *all* `react-hooks/exhaustive-deps`, and the full
suite passes (391 suites / 5596 tests / 68 snapshots, `TZ=UTC`).

---

## HIGH

### [SEVERITY: high] fix(config): `--ignoredFiles` / `--ignoredExtensions` wipe the default ignore list, exposing `.env` to the prompt

**File:** `src/lib/config/utils/loadConfig.ts` (the trailing `return { ...config, ...argv }`)

**What's wrong:** `loadConfig` builds the ignore list by unioning defaults + `.gitignore`
through `mergeIgnoreLists(config)`, and *then* spreads `argv` over the result. Because the
spread is a plain shallow overwrite, an `ignoredFiles` value arriving from the CLI
**replaces** the merged list instead of extending it — bypassing the very helper that
exists to prevent this. `mergeIgnoreLists` is called one statement too early.

**Evidence:** the merge runs before the spread, so the spread wins:

```ts
config = mergeIgnoreLists(config)
_lastConfigSources = sources
return { ...config, ...argv } as Config & ConfigType & ArgvType
```

**(verified empirically)** — same `loadConfig`, with and without the flag:

```
no flag  -> ignoredFiles: 39 entries, including
            "package-lock.json","yarn.lock","node_modules","dist/**/*",
            ".env",".env.local",".env.production.local","coverage/", …
with flag-> ignoredFiles: ["secret.ts"]                    <-- everything else gone
if merged-> ["package-lock.json","yarn.lock","pnpm-lock.yaml","bun.lockb",
             "bun.lock","node_modules","secret.ts"]        <-- what it should be
```

**Impact:** this is a secret-exposure vector, not just a token-waste bug. `.env`,
`.env.local`, and `.env.production.local` are in the default/gitignore-derived list, so
`coco commit --ignoredFiles secret.ts` (a user narrowing the ignore list, reasonably
expecting to *add* an entry) silently re-admits every dotenv file, lockfile, and
`node_modules` path to the diff that gets sent to the model. Reproduce: stage a `.env`
alongside a source file and run `coco commit --ignoredFiles secret.ts --print-message`.

Note this is the exact class of bug `mergeIgnoreLists` was introduced to fix at the
config-file layer; the argv layer never got the same treatment.

**Suggested fix:** move the argv spread *above* `mergeIgnoreLists`, so CLI-supplied lists
go through the same union as every other source. Also route argv through the existing
`removeUndefined` helper (see next finding) and strip yargs' `_` / `$0`.

**Confidence:** high

---

## MEDIUM

### [SEVERITY: medium] fix(config): the argv spread can clobber real config with `undefined` and shallow-replaces nested objects

**File:** `src/lib/config/utils/loadConfig.ts` (same trailing spread)

**What's wrong:** three separate robustness gaps in one expression. (a) The env and
git-config loaders both sanitize themselves (`removeUndefined(envConfig)` at
`services/env.ts:122`, `removeUndefined(config)` at `services/git.ts:147`) — argv does not,
so any `undefined`-valued argv key overwrites a resolved value with `undefined`. (b) The
spread is shallow, so an argv-supplied `service` replaces the whole merged service object;
`services/env.ts` has an explicit deep-merge for `service` precisely because of this. (c)
yargs' `_` and `$0` land in the returned `Config`, so `resolveConfigKeySource` and
`coco config list` see keys that aren't config.

**Evidence (verified empirically)** — calling the real `loadConfig`:

```
loadConfig({ verbose: undefined, defaultBranch: undefined, _: ['commit'], $0: 'coco' })
  verbose:       undefined   (DEFAULT_CONFIG.verbose is false)
  defaultBranch: undefined   (DEFAULT_CONFIG.defaultBranch is "main")
  has '_': true   has '$0': true

loadConfig({ service: { provider: 'anthropic' } })
  service -> {"provider":"anthropic"}   (model, authentication, endpoint all dropped)
```

**Impact:** currently **latent rather than live** — I confirmed yargs does not emit keys
for declared-but-unset options (parsing the real `commit` builder yields 19 keys, none
`undefined`). So this is a landmine, not an active defect: the first command that adds a
`coerce`, a conditional default, or hand-builds an argv object gets a silent
`defaultBranch: undefined`. `src/commands/defaultRouter.ts` already hand-builds synthetic
argv objects, which is exactly the shape that trips this.

**Suggested fix:** `return { ...config, ...removeUndefined(argv as Record<string, unknown>) }`
with `_`/`$0` omitted, and deep-merge `service` the way `env.ts` does.

**Confidence:** high (behavior verified; live impact explicitly scoped to latent)

### [SEVERITY: medium] perf(cache): the diff-summary cache rewrites the entire cache file on every write *and* every hit

**File:** `src/lib/parsers/default/utils/diffSummaryCache.ts:119` (`writeDiffSummary`), `:153` (`touchDiffSummary`)

**What's wrong:** both functions do a full synchronous read-modify-write of one shared JSON
file: `readEnvelope()` → mutate → `fs.writeFileSync()`. `touchDiffSummary` exists *only* to
update an LRU timestamp, and its own docblock says it runs "when a read returned a hit" —
so a fully-cached run pays a complete parse-and-rewrite of the cache per cache hit.

**Impact:** three compounding costs on the hot path of every AI command.

1. **Write amplification.** With the cache at its 500-entry cap, each of N summarized files
   triggers a parse + stringify + write of the whole file — O(N × cache_size) synchronous
   I/O where O(N) was intended.
2. **Event-loop blocking.** These are `*Sync` calls issued from callbacks that resolve while
   other LLM requests are in flight (`summarizeDiffs.ts:288` dispatches through a
   concurrency-6 semaphore), so each one stalls every concurrent request.
3. **Cross-process races.** Within one process the function is fully synchronous, so there
   is no lost-update window — but two coco processes (a `coco ui` AI draft plus a CLI run,
   or parallel CI jobs) genuinely interleave, and the write is not atomic. `readEnvelope`'s
   try/catch means a torn file self-heals by discarding the *entire* cache.

**Suggested fix:** hold the envelope in memory for the process lifetime, mutate it there,
and flush once on exit (or debounced). Make `touchDiffSummary` memory-only. Use the
existing `writeFileAtomic` (`src/lib/utils/atomicFileWrite.ts`) for the flush so a crash or
a competing process cannot truncate the file.

**Confidence:** high

### [SEVERITY: medium] refactor(parsers): three hand-rolled copies of a concurrency semaphore, while the declared `p-queue` dependency is never imported

**File:** `src/lib/parsers/default/utils/summarizeDiffs.ts:327`, `summarizeLargeFiles.ts:326`, `collectDiffs.ts:8`

**What's wrong:** `createLimit` is duplicated three times (two of them byte-similar), and
the shared implementation has an over-admission race: the `active >= limit` check is
performed once and is **not** re-checked after the waiter is woken.

**Evidence:**

```ts
const runNext = () => {
  active--                                   // slot freed here …
  const next = queue.shift()
  if (next) next()                           // … waiter's `active++` runs a microtask later
}

return async <T>(operation: () => Promise<T>): Promise<T> => {
  if (active >= limit) {
    await new Promise<void>((resolve) => queue.push(resolve))
  }
  active++                                   // no re-check after waking
  try { return await operation() } finally { runNext() }
}
```

Between `active--` and the woken waiter's `active++`, `active` sits at `limit - 1`. A caller
arriving in that window passes the check without queueing, so `active` reaches `limit + 1`.

**Impact:** latent at all three current call sites, because each dispatches its whole batch
up-front via `.map()` and no late arrivals exist. It becomes live the moment anything
submits work incrementally (a watch mode, an interactive re-summarize) — and it would
present as "concurrency limit is ignored", i.e. more parallel LLM calls than the user
configured, which costs money.

Separately: **`p-queue@5.0.0` is a production dependency with zero references** anywhere in
`src`, `bin`, or `e2e` — a battle-tested semaphore is already being shipped to users and
paid for, while three hand-rolled ones are used instead. `.github/dependabot.yml:9` even
carries an explicit ignore entry for it, so the pin has been maintained while the code
rotted.

**Suggested fix:** delete all three `createLimit`s, use `p-queue`, and keep one shared
wrapper in `src/lib/utils/` (next to the existing `mapWithConcurrency`). If the hand-rolled
version is kept instead, re-check `active` in a `while` loop rather than an `if`, and drop
`p-queue` from `dependencies`.

**Confidence:** high

### [SEVERITY: medium] chore(deps): `@langchain/community` is a 22 MB production dependency that is never imported

**File:** `package.json:146`

**What's wrong:** `"@langchain/community": "^1.1.29"` sits in `dependencies`, but a repo-wide
search for `@langchain/community` across `src`, `bin`, `e2e`, `rollup.config.mjs`, and
`jest.config.ts` returns **only the `package.json` line itself** — no static import, no
`await import()`, no rollup reference. Nothing else in `node_modules` depends on it either.

I checked the other four candidates my scan flagged and they are all legitimate, so this is
the only real one:

| Package | Verdict |
| --- | --- |
| `@commitlint/core` | **used** — `await import('@commitlint/core')` at `commitlintValidator.ts:106,287,311` |
| `web-tree-sitter` | **used** — lazy loader in `parsers/default/__tree_sitter__/runtime.ts` |
| `react-devtools-core` | **legitimate** — declared peer dep of `ink@7` (`>=6.1.2`) |
| `p-queue` | unused (see previous finding) |
| `@langchain/community` | **unused** |

**Impact:** 22 MB of install weight on every `npm i -g git-coco`, plus its transitive
surface in every `npm audit` and Dependabot run, for zero functionality. It also implies a
capability coco doesn't have — a reader scanning `dependencies` reasonably concludes the
community provider set is available.

**Suggested fix:** remove both `@langchain/community` and `p-queue` from `dependencies`
(the latter only after the semaphore consolidation above), and add a CI check — a
`depcheck`/`knip` step, or extend `bin/smokeCli.ts` — so an unreferenced production
dependency fails the build.

**Confidence:** high

### [SEVERITY: medium] fix(langchain): the prompt-budget accept threshold and trim target disagree by `responseTokenReserve`

**File:** `src/lib/langchain/utils/enforcePromptBudget.ts` (fast-path return vs. `tokenBudget`)

**What's wrong:** the early-return accepts any prompt at or under `maxTokens`, ignoring the
response reserve entirely. But once trimming engages, the target becomes
`maxTokens - responseTokenReserve`. The reserve therefore either matters or it doesn't,
depending on which side of the threshold you land on.

**Evidence:**

```ts
if (promptTokenCount <= maxTokens) {
  return { variables, promptTokenCount, truncated: false }   // reserve ignored
}
…
const tokenBudget = maxTokens - responseTokenReserve          // reserve enforced
```

**Impact:** a discontinuous cliff at the boundary. A prompt at exactly `maxTokens` ships
untouched with no room reserved for the completion; a prompt one token larger is trimmed
all the way down to `maxTokens - 512`. So the case most likely to be truncated by the
*provider* (a prompt that exactly fills the window) is the one case coco waves through,
while a marginally larger prompt loses 512 tokens of real diff content it didn't need to.

**Suggested fix:** pick one semantic. Either `maxTokens` is the prompt budget (drop the
reserve from `tokenBudget`) or it is the request budget (compare the fast path against
`maxTokens - responseTokenReserve` too). Document which in the docblock, since
`DEFAULT_RESPONSE_TOKEN_RESERVE` is exported for callers to pre-budget with.

**Confidence:** high

### [SEVERITY: medium] perf(langchain): the block-drop comparator re-tokenizes every block on each comparison

**File:** `src/lib/langchain/utils/enforcePromptBudget.ts` (`trimSummaryByBlocks`)

**What's wrong:** the sort comparator calls the tokenizer twice per invocation instead of
precomputing each block's size once.

**Evidence:**

```ts
const dropQueue = [...blocks].sort((a, b) => tokenizer(b.text) - tokenizer(a.text))
```

**Impact:** `Array.prototype.sort` invokes the comparator O(n log n) times, so for 50
directory blocks that's roughly 600 full tiktoken encodes of substantial text — all
redundant, all on the main thread, and all inside the path that only runs when the prompt is
*already* oversized (i.e. when the blocks are at their largest). This is on top of the
~17 full-prompt renders-and-encodes the subsequent binary search performs.

**Suggested fix:** `const sized = blocks.map((b) => ({ ...b, tokens: tokenizer(b.text) }))`
once, then sort on `tokens`. Pure win, no behavior change.

**Confidence:** high

### [SEVERITY: medium] fix(cli): `getRepo` writes its failure to stdout, corrupting every `--json` consumer

**File:** `src/lib/simple-git/getRepo.ts:20`

**What's wrong:** the failure path uses `console.log` (stdout) rather than the logger or
stderr, and discards `baseDir` — the one piece of actionable context the caller supplied.

**Evidence:**

```ts
try {
  git = baseDir ? simpleGit(baseDir) : simpleGit()
} catch (e) {
  console.log('Error initializing git repo', e)
  commandExit(1)
}
```

**Impact:** `getRepo` is upstream of essentially every command, so on failure a non-JSON
line is emitted **on stdout** before the process exits — breaking `coco commit --json`,
`coco review --json`, `coco prs --json`, and the agent CLI for any machine consumer doing
`JSON.parse(stdout)`. It also defeats `--quiet`, which the logger would honor. Reproduce:
`coco commit --json --repo /path/that/is/not/a/repo`.

**Suggested fix:** `logger.error(\`Error initializing git repo${baseDir ? \` at ${baseDir}\` : ''}: ${message}\`)`,
or at minimum `process.stderr.write`. The same audit turned up `console.log` in
`src/lib/ui/TaskList.ts` (many sites) — acceptable there since it is an interactive-only
surface, but worth a lint rule banning bare `console.log` under `src/lib/**` outside `ui/`.

**Confidence:** high

---

## LOW

### [SEVERITY: low] fix(langchain): `trimSummaryByBlocks` can return an over-budget prompt without throwing

**File:** `src/lib/langchain/utils/enforcePromptBudget.ts` (`trimSummaryByBlocks`, the final binary search)

**What's wrong:** the search seeds `bestSummary` with separator + omitted-marker and
accepts its token count unconditionally — it is never compared against `tokenBudget`. Every
other exhaustion path in this module throws a clear error; this one returns silently.

**Evidence:**

```ts
let bestSummary = `${DIRECTORY_BLOCK_SEPARATOR}${marker}`
let bestTokenCount = await render(bestSummary)   // never checked against tokenBudget
```

Compare the sibling path, which does the right thing:

```ts
if (emptySummaryTokenCount > maxTokens) {
  throw new Error(`Rendered prompt exceeds token budget before adding ${summaryKey}: …`)
}
```

**Impact:** narrow but real. Reaching `trimSummaryByBlocks` requires
`overhead < maxTokens - reserve`, so the overflow needs the omitted-files marker to push it
back over — an edge case, but when it happens coco reports `truncated: true` and sends an
over-budget request, so the user sees the provider's `context_length_exceeded` instead of
coco's own actionable message.

**Suggested fix:** after the search, throw the same style of error when
`bestTokenCount > tokenBudget`.

**Confidence:** high

### [SEVERITY: low] fix(langchain): the "N files omitted" count undercounts dropped directories

**File:** `src/lib/langchain/utils/enforcePromptBudget.ts` (`countFileBullets`)

**What's wrong:** `omittedFileCount` only counts lines starting with `FILE_BULLET_PREFIX`,
so a dropped block's directory header — and any non-bullet content in it — is invisible.

**Evidence:**

```ts
function countFileBullets(blockText: string): number {
  return blockText.split('\n').filter((line) => line.startsWith(FILE_BULLET_PREFIX)).length
}
```

**Impact:** the marker the model sees (`[N files omitted for length]`) understates what was
dropped, so the model's own hedging about incompleteness is calibrated to the wrong number.
Cosmetic-adjacent, but it is the only signal the model gets that the diff is partial.

**Suggested fix:** count directory blocks as well, or reword the marker to
`[N files across M directories omitted for length]`.

**Confidence:** high

### [SEVERITY: low] fix(parsers): summarization failures are swallowed to `console.error`, bypassing the logger and `--quiet`

**File:** `src/lib/parsers/default/utils/summarizeLargeFiles.ts:302`, `summarizeDiffs.ts:133`

**What's wrong:** both catch blocks return the original (unsummarized) diff and report via
bare `console.error`, so the failure never reaches the logger, never respects `--quiet`, and
never surfaces as a warning the caller can attach to the result.

**Evidence:**

```ts
} catch (error) {
  // On error, return original diff unchanged
  console.error(`Failed to summarize file ${fileDiff.file}:`, error)
  return fileDiff
}
```

**Impact:** silent degradation with a real consequence — returning the *unsummarized* diff
is precisely what blows the token budget the summarizer exists to protect, so a run that
silently loses every summarization ends up trimming real content in
`enforcePromptBudget` instead. The `logger` is already threaded into both functions'
options, so the correct channel is in hand.

**Suggested fix:** use the injected `logger.verbose`/`logger.warn`, and count failures so
the caller can report "summarization degraded for N files".

**Confidence:** high

---

## Areas I checked and found clean

- **tiktoken encoder lifecycle** (`src/lib/utils/tokenizer.ts`) — `tikTokenCache` correctly
  prevents the WASM-heap leak the docblock describes (`#1641`); handles are intentionally
  never `free()`d because the cache is bounded by the handful of distinct model names a
  process uses. The `encoding_for_model` → `fallbackEncodingForModel` fallback correctly
  avoids crashing on Azure custom deployment names and post-pin OpenAI ids, and the
  `o200k_base`-by-default / `cl100k_base`-for-legacy split is the right approximation.
- **`tokenCorrectionFactor` application** — applied in exactly one place
  (`getTokenCounterForProvider`) and correctly skipped for the two tiktoken-native providers,
  so the two budget paths cannot diverge. Both the scalar and the per-model-function forms
  are handled, with a `?? 1` fallback.
- **Surrogate-pair safety in truncation** — `stripTrailingHighSurrogate` is applied at both
  char-slice sites, so a budget slice can never emit a lone high surrogate (the failure mode
  strict providers reject).
- **`summaryBudget === 0` exhaustion path** — correctly re-renders with an empty summary and
  throws a precise, actionable error rather than shipping an over-budget request.
- **Config precedence order** — the load sequence (defaults → XDG → git → project → env)
  produces the documented precedence, since each later source overwrites earlier ones. The
  env loader's `SERVICE_SCALAR_ENV_KEYS` ordering puts `COCO_SERVICE_PROVIDER` ahead of the
  keys whose interpretation depends on it, and `PROVIDER_API_KEY_ENV_VARS` resolution
  correctly keys off the *effective* provider, so a config-file provider plus an env-var key
  for a different provider does not cross-wire.
- **`COCO_SERVICE_BASE_URL` provider gating** — gating it on the `openai` provider is
  correct, not a bug: `LLMProvider` has no separate `openai-compatible` member, and
  OpenAI-compatible endpoints are reached via `openai` + `baseURL` by design.
- **Secret redaction in `coco config`** — `SENSITIVE_SEGMENTS` + `maskSecrets` are applied on
  every read path (`get`, `list`, and both `emitJson` branches), so keys are masked in JSON
  output too. `doctor/checks.ts` reads `authentication.credentials?.apiKey` only to test for
  presence and never prints the value.
- **Exit-code flushing** — `commandExit` throws a `CommandExitError` that
  `commandExecutor` converts to `process.exitCode` rather than calling `process.exit()`, so
  stdout is always flushed before exit; prompt cancellation maps to the conventional 130.
- **`writeFileAtomic`** (`src/lib/utils/atomicFileWrite.ts`) — correct tmp+rename with a
  `0o600` default. (The finding that config writers don't *use* it belongs to the commands
  audit, not here.)
- **Corrupted-cache self-healing** — `readEnvelope`'s try/catch means a torn or truncated
  cache file is discarded rather than crashing the CLI; the LRU `enforceHardCap` runs after
  insertion, so the cap is respected.
