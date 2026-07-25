# coco — feature / extension scoping

**Target:** `/projects/sandbox/coco` (`git-coco` v0.84.1)
**Method:** full read of `src/git/forgeActions.ts` + every per-forge implementation, `src/lib/langchain/providers/**`, `src/commands/**` mount table in `src/index.ts`, `src/workstation/surfaces/**` + `runtime/inkKeymap.ts` + `KEYMAP.md`, `src/mcp/server.ts`, `src/operations/agent/**`, `.github/workflows/**`, `packaging/`, `install.sh`, `bin/**`, and both in-repo implementation specs. No files were created or modified inside the repo.
**Excluded as duplicates:** #1370, #1371, #1722, #1819, #1820, #1241, #1822–#1830.

---

## Headline finding: one designed spec is 100% unimplemented

| Spec | Status | Evidence |
|---|---|---|
| `.kiro/specs/review-autofix-agent/` | **Shipped.** All 15 tasks (incl. optional 11/12) checked. | `src/lib/autofix/{index,buildPrompt,types}.ts` + `adapters/{codex,claude,gemini}.ts` all exist with co-located tests; `autoFixTool` / `autoFixToolOptions` present at `src/lib/config/types.ts:97,104`. |
| `.kiro/specs/ai-conflict-resolution/` | **0 of 15 tasks done.** Every checkbox in `tasks.md` is `- [ ]`. | `src/commands/resolve/` does not exist. `grep -rn conflictResolve src/` returns **nothing** — the `DynamicModelTask` union never got the task. `grep -n confidence src/git/conflictAiActions.ts` returns **nothing** — the `ProposalsSchema` confidence field was never added. No conflict-marker validation in `conflictRegionActions.ts`. |

The conflict spec has requirements → design → a 15-task plan naming exact files and line numbers, and the underlying TUI machinery it builds on (`src/git/conflictAiActions.ts`, `src/git/conflictRegionActions.ts`, `src/workstation/runtime/conflictResolutionState.ts`, `useConflictResolutionActions.ts`) is all shipped from #1369. **This is the single highest-leverage item in this report: a fully designed, fully specified feature sitting at zero implementation on top of a working data layer.** See P0-1.

---

## Forge capability × provider matrix

Derived from the `ForgeActions` type and the four facades in `src/git/forgeActions.ts`. GitHub Enterprise is not a separate row — `detectProvider` (`src/git/providerData.ts:110`) folds `*github*` hosts into `github` and the `gh` CLI handles the host.

Legend: ✅ real implementation · ⚠️ implemented with a semantic compromise · ❌ hard-coded `{ ok: false }` refusal.

| `ForgeActions` capability | GitHub / GHE (`gh`) | GitLab (`glab api`) | Bitbucket Cloud (`fetch`) | Gitea / Forgejo / Codeberg (`fetch`) |
|---|---|---|---|---|
| `getPullRequestList` | ✅ | ✅ | ✅ | ✅ |
| `getIssueList` | ✅ | ✅ | ✅ | ✅ |
| `getPullRequestDetail` | ✅ | ✅ | ✅ | ✅ |
| `getIssueDetail` | ✅ | ✅ | ✅ | ✅ |
| `getPullRequestDiffByNumber` | ✅ | ✅ | ❌ `forgeActions.ts:277` | ✅ `getGiteaPullRequestDiff` |
| `checkoutPullRequestByNumber` | ✅ | ✅ | ❌ `forgeActions.ts:286` | ❌ `forgeActions.ts:347` |
| `commentPullRequestByNumber` | ✅ | ✅ | ✅ | ✅ |
| `addPullRequestLabel` | ✅ | ✅ | ❌ `bitbucketPullRequestActions.ts:144` | ✅ |
| `addPullRequestAssignee` | ✅ assignee | ✅ assignee | ⚠️ maps to **reviewer** | ⚠️ maps to **reviewer** |
| `mergePullRequestByNumber` | ✅ | ✅ | ✅ | ✅ |
| `closePullRequestByNumber` | ✅ | ✅ | ✅ | ✅ |
| `approvePullRequestByNumber` | ✅ | ✅ | ✅ | ✅ |
| `requestChangesPullRequestByNumber` | ✅ | ✅ | ✅ | ✅ |
| `mergePullRequest` (current branch) | ✅ | ✅ | ⚠️ needs `currentBranch` threaded | ⚠️ needs `currentBranch` threaded |
| `closePullRequest` / `approvePullRequest` / `commentPullRequest` / `requestChangesPullRequest` | ✅ | ✅ | ⚠️ same | ⚠️ same |
| `createPullRequest` | ✅ | ✅ | ✅ | ✅ |
| `openPullRequest` | ✅ | ✅ | ✅ | ✅ |
| `commentIssue` | ✅ | ✅ | ✅ | ✅ |
| `addIssueLabel` | ✅ | ✅ | ❌ `bitbucketIssueActions.ts:35` | ✅ |
| `addIssueAssignee` | ✅ | ✅ | ✅ | ✅ |
| `closeIssue` / `reopenIssue` | ✅ | ✅ | ✅ | ✅ |

### Data-model parity (rendered but outside the facade)

| Field | GitHub | GitLab | Bitbucket | Gitea |
|---|---|---|---|---|
| `isDraft` | ✅ | ✅ `draft ?? work_in_progress` | ✅ | ✅ `isDraftPR()` title heuristic |
| `reviewDecision` | ✅ `pullRequestListData.ts:128` | ❌ hard `undefined` (`gitlabListData.ts:177,314`) | ❌ hard `undefined` (`bitbucketListData.ts:144`) | ❌ hard `undefined` (`giteaListData.ts:127`) |
| `statusCheckRollup` (detail) | ✅ native | ⚠️ one synthetic `pipeline` check (`gitlabDetailData.ts:129`) | ⚠️ commit statuses | ⚠️ commit statuses |
| `reviews` (detail) | ✅ native | ⚠️ approvals mapped to reviews | ⚠️ participants mapped to reviews | ✅ native |

### Capabilities the adapter does not model **for any forge**

Not "missing on forge X" — absent from the `ForgeActions` type entirely: **draft → ready transition** (`isDraft` is read-only; `grep -rni markReady|readyForReview src/` is empty), **reopen a PR** (issues can reopen, PRs cannot), **auto-merge / merge-when-pipeline-succeeds**, **check re-run** (`grep -rni rerun src/git` finds only prose), **line-level review threads** (read or write), **request reviewers as a distinct verb**, **remove label / remove assignee** (add-only), **edit PR title/body/base**, **update-branch / sync-with-base**, **create an issue** (`grep -rn createIssue src/` is empty — `coco issues` can comment/label/assign/close/reopen but not open one), **milestones**, **projects**, **releases**, **GitHub Discussions**, **wikis**, **CODEOWNERS / required-reviewer awareness**, **cross-repo search**.

### Forges missing entirely

`GitProviderType` (`providerData.ts:29`) is `github | gitlab | bitbucket | gitea | unsupported`. Not modelled: **Azure DevOps / TFS**, **Bitbucket Server / Data Center** (any `*bitbucket*` host collapses into the Cloud facade, whose API base is a fixed cloud constant), **sourcehut**, **Gogs**, **Radicle**. Forgejo and Codeberg are covered by the Gitea facade (`detectProvider` maps `codeberg.org`, `*forgejo*`, `*gitea*`).

---

## Provider registry coverage

Derived from `PROVIDERS` in `src/lib/langchain/providers/registry.ts` (7 entries) and the per-provider `ProviderDynamicDefaults` tables in `src/lib/langchain/utils/dynamicModels.ts`.

| Provider | Registered? | `requiresAuth` | Token correction | Dynamic-model defaults | Init-wizard entry |
|---|---|---|---|---|---|
| OpenAI | ✅ `openai.ts` | true | none (tiktoken native) | ✅ gpt-5.4 family | ✅ |
| Anthropic | ✅ `anthropic.ts` | true | ✅ 1.2 | ✅ claude-4.x family | ✅ |
| Azure OpenAI | ✅ `azure.ts` | true | none | ✅ | ✅ |
| Google Gemini (API) | ✅ `gemini.ts` | true | ✅ | ✅ gemini-2.5 family | ✅ |
| Mistral | ✅ `mistral.ts` | true | ✅ | ✅ | ✅ |
| AWS Bedrock | ✅ `bedrock.ts` | false (cred chain) | ✅ per-model fn | ✅ | ✅ |
| Ollama (local) | ✅ `ollama.ts` | false | ✅ 1.2 | ✅ | ✅ |
| OpenRouter / any OpenAI-compatible | ⚠️ **reachable only** via `service.baseURL` on the `openai` provider (`openai.ts:26-28`) | — | ❌ inherits OpenAI's *none* → undercounts non-tiktoken models | ❌ none | ❌ |
| DeepSeek, xAI/Grok, Groq, Together, Fireworks, GitHub Models, Cloudflare Workers AI | ❌ same `baseURL` workaround, same three gaps | — | ❌ | ❌ | ❌ |
| LM Studio / vLLM / llama.cpp server | ❌ same workaround (OpenAI-compatible), *not* reachable through the Ollama provider — `ollama.ts` hardcodes `ChatOllama` + `numPredict` | — | ❌ | ❌ | ❌ |
| Google Vertex AI | ❌ not registerable — needs ADC / service-account auth, which `CreateLlmArgs` (`apiKey: string`) cannot express | — | — | — | — |
| Cohere, AI21, Watsonx, Databricks | ❌ | — | — | — | — |

### Provider-level features unmodelled

- **Prompt caching.** Nothing in `openai.ts` / `anthropic.ts` sets `cache_control` or reads `cache_read_input_tokens`. `UsageRecord` (`usageLedger.ts:21`) has `promptTokens` / `completionTokens` only — cached reads are invisible.
- **Batch API.** No batch submission path anywhere; every call is synchronous `chain.invoke`.
- **Reasoning-effort / thinking budget.** Only through the untyped `service.fields` escape hatch (`Object.assign(openaiConfig, config.service.fields)`), so it is undiscoverable, unvalidated, and absent from `schema.json`.
- **Native structured output / JSON mode.** `grep -rn "withStructuredOutput|responseFormat|json_object" src/lib` returns **zero hits**. Every structured task goes through `PromptTemplate` → text → parser → zod validate, with a dedicated `repair` dynamic-model task to retry malformed JSON (`executeChainWithSchema.ts`). That repair round-trip is pure cost that native JSON-schema mode removes.
- **Vision input, tool calling.** Neither modelled (tool calling is arguably out of scope for read-only generation; vision is not — screenshots in PR descriptions are common).
- **Provider-native token counting.** `tokenCorrectionFactor` (1.2 fudge over the gpt-4o tiktoken baseline) stands in for Anthropic's `count_tokens` and Gemini's `countTokens`.

---

# P0 — table stakes gaps users will hit

### [PRIORITY: P0] [EFFORT: L] feat(resolve): ship the designed-but-unimplemented `coco resolve` CLI
**Category:** command
**Gap:** `.kiro/specs/ai-conflict-resolution/tasks.md` has 15 tasks, all unchecked. `src/commands/resolve/` does not exist; `conflictResolve` is absent from the `DynamicModelTask` union in `src/lib/langchain/types.ts`; `ProposalsSchema` in `src/git/conflictAiActions.ts` has no `confidence` field; `applyConflictResolution` in `src/git/conflictRegionActions.ts` does not reject replacements that still contain `<<<<<<<`. AI conflict resolution today is reachable **only** from inside `coco ui`'s conflicts surface.
**Why it matters:** Conflict resolution is the highest-pain git moment and the one place scripted/CI use matters most (`coco resolve status` for exit-code gating, `--apply --confidence high` for unattended rebases). Today a user mid-rebase in a terminal without the TUI has nothing. The absent marker validation is also a correctness hazard in the shipped TUI path.
**Sketch:** Execute the spec as written — it names the files and line numbers. Data layer first: `src/lib/langchain/types.ts` + `utils/dynamicModels.ts` (`conflictResolve` task, falling back to `review`'s model), `conflictAiActions.ts` (confidence enum, per-region chunking, `runConflictExplanationWorkflow`), `conflictRegionActions.ts` (marker guard). Then `src/commands/resolve/{config,index,handler,statusHandler,explainHandler,resolveHandler,prompt}.ts` mounted in `src/index.ts`. Regenerate `schema.json`.
**Already-there leverage:** `getConflictedFiles`, `getInProgressOperationType`, region parsing, `applyConflictResolution`, `stageConflictResolved`, `runConflictResolutionWorkflow`, and the `$EDITOR` spawn pattern in `useConflictResolutionActions.ts` are all shipped. The spec estimates the command layer as incremental (status → explain → resolve).
**Effort notes / risks:** L overall, but splits cleanly into ~4 PRs (tasks 1–4 data layer, 6–7 status, 8 explain, 9–11 resolve). Touches the shipped TUI path (confidence field is additive; marker guard changes behavior — it *rejects* previously-accepted writes, which is the point). Schema drift gate in CI will fail unless `schema.json` is committed.

### [PRIORITY: P0] [EFFORT: S] feat(forge): add draft→ready and PR reopen to the forge adapter
**Category:** forge parity
**Gap:** `ProviderPullRequestStatus.isDraft` is read and rendered (header chips, triage rows, all four forges), and `pr create -d/--draft` can *create* a draft — but there is no way to promote one. `grep -rni "markReady|readyForReview" src/` is empty. Symmetrically, `ForgeActions` has `reopenIssue` but no `reopenPullRequest`.
**Why it matters:** "Open as draft, finish, mark ready" is the single most common PR lifecycle, and coco supports two of the three steps. Every user who uses `-d` hits this. Accidentally closing a PR from the triage view (`ForgeActions.closePullRequestByNumber` is one keystroke) is currently unrecoverable inside coco.
**Sketch:** Add `markPullRequestReady(n)` and `reopenPullRequest(n)` to the `ForgeActions` type in `src/git/forgeActions.ts`; implement in `pullRequestActions.ts` (`gh pr ready`), `mergeRequestActions.ts` (`glab api ... PUT` clearing the `Draft:` title prefix), `bitbucketPullRequestActions.ts` (`PUT /pullrequests/{id}` with `draft: false`), `giteaPullRequestActions.ts` (`PATCH /pulls/{n}`). Bind keys in the pull-request and pullRequestTriage surfaces via `inkKeymap.ts` + `KEYMAP.md`.
**Already-there leverage:** Four working runners, a uniform `PullRequestActionResult`, and an established by-number mutation pattern to copy line-for-line. Gitea's draft model is a title prefix, and `isDraftPR()` in `giteaListData.ts:108` already encodes that heuristic.
**Effort notes / risks:** Honors the "add to `ForgeActions`, implement for every provider" invariant. GitLab/Gitea draft-as-title-prefix means the implementation is a title rewrite, not a flag — needs care not to clobber a user-authored title.

### [PRIORITY: P0] [EFFORT: M] feat(observability): dollar-denominated cost, per-model pricing, and budget caps
**Category:** observability
**Gap:** `coco doctor --cost` renders `"${promptTokens} in / ${completionTokens} out tok"` (`src/commands/doctor/handler.ts:30-33`). There is no price table anywhere — `grep -rni "pricePer|costUsd|pricing" src/lib src/commands` returns one unrelated hit. `UsageAggregate` has no cost field, and there is no cap, alert, or pre-flight estimate.
**Why it matters:** "Cost" that reports tokens is not a cost report. Users on `service.model: "dynamic"` with a `quality` preference are routed to `gpt-5.5` / `claude-opus-4-8` for every commit and have no way to see the bill or bound it. Teams cannot adopt `dynamic` routing without a budget guardrail. This is the difference between a telemetry feature and a cost feature.
**Sketch:** Add `src/lib/langchain/pricing.ts` — a `Record<LLMModel, { inputPer1M, outputPer1M, cachedInputPer1M? }>` table with an `unknown → undefined` fallback so unpriced models degrade to tokens instead of lying. Extend `UsageAggregate` in `usageLedger.ts` with `estimatedCostUsd`; extend `summarizeUsageBy*` to sum it; extend the doctor renderer. Add `telemetry.budget: { monthlyUsd, warnAtPercent }` to `src/lib/config/types.ts` and a check in `src/commands/doctor/checks.ts`; enforce a soft warning at call time from `observability.ts`.
**Already-there leverage:** The ledger already records `provider`, `model`, `promptTokens`, `completionTokens` per call with bounded size and a working consent gate — the entire data-collection half is done. `doctor/checks.ts` already has a fix-suggestion mechanism to hang budget warnings on.
**Effort notes / risks:** The price table is a maintenance treadmill; ship it as data with an explicit `pricesAsOf` date and label output "estimated". Must not weaken the `telemetry.usage` / `COCO_USAGE_LOG` gate or start recording anything beyond metadata.

### [PRIORITY: P0] [EFFORT: M] feat(provider): use native structured output / JSON mode instead of parse-and-repair
**Category:** provider
**Gap:** Zero uses of `withStructuredOutput` / `responseFormat` / `json_object` in `src/lib`. Structured tasks (commit split plan, review findings, conflict proposals) prompt for JSON as free text, parse it, validate with zod, and on failure spend a whole extra LLM call on the dedicated `repair` dynamic-model task.
**Why it matters:** Every malformed-JSON retry is a paid round-trip and a latency spike on exactly the heaviest tasks (`commitSplit`, `review`, `largeDiff`). Providers that support native JSON-schema constrained decoding make that failure mode structurally impossible. This is a direct cost *and* reliability win on the features coco markets hardest.
**Sketch:** Add an optional `supportsStructuredOutput?: 'json-schema' | 'json-mode'` to `ProviderDefinition` in `providers/types.ts`; set it on `openai`, `azure`, `gemini`, `mistral`, `ollama` (format=json). In `executeChainWithSchema.ts`, when the resolved provider advertises support and the caller supplied a zod schema, bind it via `llm.withStructuredOutput(schema)` and skip the text parser; otherwise keep today's path verbatim. Keep `repair` as the fallback for non-supporting providers.
**Already-there leverage:** Callers already pass zod schemas (`ProposalsSchema` and friends), so the schema is in hand at the call site — no new plumbing. `ProviderDefinition` is explicitly designed as the place for per-provider capability facts (`tokenCorrectionFactor` is the precedent).
**Effort notes / risks:** Must stay opt-in-by-capability so Bedrock/Anthropic/local paths are untouched. Structured-output mode changes token accounting slightly (schema is billed as input) — coordinate with the cost work above. Behavior change is observable in snapshot tests of prompts.

### [PRIORITY: P0] [EFFORT: M] feat(provider): first-class OpenAI-compatible provider presets (DeepSeek, Groq, xAI, Together, Fireworks, LM Studio, vLLM)
**Category:** provider
**Gap:** All of these are *technically* reachable by setting `service.baseURL` on the `openai` provider (`openai.ts:26-28`), but they get none of the registry's benefits: no entry in `PROVIDERS`, no `tokenCorrectionFactor` (so a Llama- or DeepSeek-tokenized prompt is counted with the gpt-4o tiktoken baseline and *undercounts*, which feeds directly into `enforcePromptBudget`), no `ProviderDynamicDefaults` row (so `service.model: "dynamic"` cannot work), no init-wizard entry, no endpoint in `doctor`. Note the local-server case specifically: LM Studio / vLLM / llama.cpp are **not** reachable through `ollama.ts`, which hardcodes `ChatOllama` and `numPredict`.
**Why it matters:** Cost-sensitive and privacy-sensitive users are the two loudest segments for a tool like this, and both are currently steered into an undocumented escape hatch with a silently wrong token budget. Undercounting tokens means prompt-budget enforcement fails open and calls get rejected by the provider instead of pre-trimmed.
**Sketch:** Add `src/lib/langchain/providers/openaiCompatible.ts` — a factory that stamps out `ProviderDefinition`s sharing `createOpenAiLlm` but carrying their own `id`, `label`, default `baseURL`, env-var name, and `tokenCorrectionFactor`. Register `deepseek`, `groq`, `xai`, `together`, `fireworks`, `openrouter`, `lmstudio`, `vllm` in `registry.ts`. Add a `ProviderDynamicDefaults` row per provider in `dynamicModels.ts`. Extend `LLMProvider` and the init wizard choices. Regenerate `schema.json`.
**Already-there leverage:** The registry was built for exactly this — its docblock says "adding a provider is a matter of writing a `ProviderDefinition` module and registering it here." `createOpenAiLlm` already handles `baseURL` and `fields` merge, and lazy `await import()` keeps startup cost flat regardless of how many presets are added.
**Effort notes / risks:** M mostly because of the per-provider model catalogs in `dynamicModels.ts` (3 preferences × 8 tasks each) and the auth-resolver env-var mapping. Model ids churn fast; consider allowing a preset to opt out of `dynamic` rather than shipping a stale catalog.

### [PRIORITY: P0] [EFFORT: S] feat(ci): gate the diff-condensing benchmark against the committed baseline
**Category:** observability
**Gap:** `bin/benchmark.ts` and `.bench/baseline.json` exist and the bench already prints a baseline diff, but `grep -rn bench .github/workflows/` finds only a DevSkim *exclude* path. Nothing runs `npm run bench` in CI. The workstation bench (`bin/benchmarkWorkstation.ts`) is likewise unwired.
**Why it matters:** The diff-condensing pipeline is the hot path for every AI command and the thing whose regressions cost users real money (more `llmCalls` = higher bill). The baseline is already checked in, so the repo is one workflow step away from catching a regression at PR time instead of in a release. Cheapest high-value item in this report.
**Sketch:** Add a `bench` job to `.github/workflows/ci.yml` (mirroring the existing `integration` job shape) running `npm run bench`; teach `bin/benchmark.ts` a `--check` flag that exits non-zero when `llmCalls` or `durationMs` regress past a tolerance versus `.bench/baseline.json`, and post the diff as a PR summary. The mock chain is deterministic, so no API keys or secrets are needed.
**Already-there leverage:** Deterministic latency model, fixture set, baseline file, and the diff printer all exist. CI already has a `visual-regression` job that demonstrates the artifact-upload pattern.
**Effort notes / risks:** S. Needs a sane tolerance so runner variance doesn't produce flakes — gate on `llmCalls` (fully deterministic) strictly and `durationMs` loosely, following the same "artifact first, gate later" caution the `visual-regression` job documents.

### [PRIORITY: P0] [EFFORT: M] feat(forge): fetch Bitbucket Cloud PR diffs instead of refusing
**Category:** forge parity
**Gap:** `forgeActions.ts:277-278` hard-codes `{ ok: false, message: 'Pull request diffs are not supported for Bitbucket yet.' }`. Bitbucket Cloud's REST API *does* expose `GET /2.0/repositories/{ws}/{slug}/pullrequests/{id}/diff`; the comment's stated reason is "no CLI patch fetch", but the Bitbucket facade doesn't use a CLI at all — it uses `fetch`.
**Why it matters:** This one refusal disables the triage `Enter → diff` drill-in **and** `coco review --pr <n>` for every Bitbucket user, i.e. it silently removes the AI review feature for a whole supported forge. `review/handler.ts:119` calls `forge.getPullRequestDiffByNumber` and dead-ends.
**Sketch:** Implement `getBitbucketPullRequestDiff(path, n, runner)` in `src/git/bitbucketDetailData.ts` against `/diff` (raw text, follows a redirect), returning the shared `PullRequestDiffResult`; wire it into `bitbucketActions` in `forgeActions.ts`. Gitea's `getGiteaPullRequestDiff` is the exact template.
**Already-there leverage:** `defaultBitbucketRunner` + pagination helpers + `PullRequestDiffResult` shape + a working Gitea implementation of the identical capability. Bitbucket integration tests already exist (`bitbucket.integration.test.ts`).
**Effort notes / risks:** M not S because the `/diff` endpoint returns a redirect to raw content and the runner currently assumes JSON — that's a small runner extension, and the raw-text path needs its own test. Same gap exists for `checkoutPullRequestByNumber` on Bitbucket and Gitea, which is genuinely harder (needs `git fetch` of the source ref) — worth a follow-up issue.

### [PRIORITY: P0] [EFFORT: M] feat(lint): audit and reword existing commit history against commitlint
**Category:** command
**Gap:** coco's commitlint integration only ever runs *forward* — validating a message it is about to write (`commit`, `amend`, `commitSplit`). There is no way to ask "is my branch's history conventional?" `src/index.ts` mounts 20 commands; none of them read history for message quality.
**Why it matters:** Repos adopting Conventional Commits mid-stream, and anyone about to squash-merge a messy branch, need exactly this. It is also the natural CI gate: `coco lint --since origin/main --severity`. coco already owns the commitlint config discovery and the AI rewriting capability — no other tool combines both.
**Sketch:** New `src/commands/lint/{config,index,handler}.ts` mounted in `src/index.ts`. Read the range via `src/git/logData.ts`, validate each subject through the existing commitlint loader used by `src/commands/commit/`, and for failures call a new `reword` prompt to propose a conforming subject. Flags: `--since`, `--range`, `--json`, `--fix` (writes an interactive-rebase `reword` todo through `src/git/rebasePlanActions.ts`), `--severity` for exit-code gating.
**Already-there leverage:** commitlint discovery + validation is shipped; `buildRebaseTodo` / `executeRebasePlan` in `rebasePlanActions.ts` already build and run `reword` todos; `--severity`-style CI gating is already proven in `src/commands/review/config.ts`; `--json` is a global flag.
**Effort notes / risks:** The read-only lint path is S; `--fix` is what makes it M, because rewriting published history is dangerous — default to dry-run, require explicit `--fix`, refuse when the range contains merges or is already pushed unless forced.

### [PRIORITY: P0] [EFFORT: M] feat(distribution): official GitHub Action, pre-commit hook, and container image
**Category:** distribution
**Gap:** No `action.yml`, no `Dockerfile`, no `.pre-commit-hooks.yaml` at the repo root. `packaging/` contains a single Homebrew formula. Shell completions *do* exist (`src/index.ts:247-293`, bash/zsh/fish) and `install.sh` covers curl-install — so the gap is specifically **CI and hook-framework** distribution.
**Why it matters:** `coco review --severity 7` and `coco lint` are CI-shaped features with no CI-shaped delivery: every adopter hand-writes a workflow that installs Node 22, npm-installs `git-coco`, and plumbs `OPENAI_API_KEY`. The repo's own `.github/workflows/ai-review.yml` is evidence the demand exists in-house. A pre-commit hook only exists as coco's own bespoke `prepare-commit-msg` installer (`src/commands/hooks/manageHooks.ts`), which the millions of repos on the `pre-commit` framework cannot use.
**Sketch:** (1) `action.yml` — composite action wrapping `setup-node` + `npm i -g git-coco@<ref>` + a `command` input, with `severity`/`json` passthrough and outputs for the findings JSON. (2) `.pre-commit-hooks.yaml` declaring a `coco-commit-msg` hook. (3) `Dockerfile` on `node:22-alpine` with `gh` and `glab` preinstalled, published from `publish-release.yml` alongside npm. (4) A README/wiki "Use coco in CI" section.
**Already-there leverage:** `--json`, `--quiet`, `--repo`, and `--severity` exit-code gating already make every command CI-friendly; `bin/smokeCli.ts` gives a ready smoke target for the container; `publish-release.yml` + `update-homebrew-tap.yml` show the release-fanout pattern to copy.
**Effort notes / risks:** M spread across three independent deliverables — file as three issues under one umbrella. The container needs a decision on whether forge CLIs are baked in (size) or expected from the host.

---

# P1 — significant gaps and differentiating bets

### [PRIORITY: P1] [EFFORT: L] feat(forge): line-level review threads — read them, and post AI review as inline comments
**Category:** forge parity
**Gap:** `PullRequestDetail` (`pullRequestDetailData.ts:31-37`) carries `body`, `comments`, `reviews`, `statusCheckRollup` — all thread-level. There is no notion of a review *thread* anchored to a file and line, in either direction. `coco review --pr <n> --comment` posts one markdown blob as a PR-level comment (`review/handler.ts:374-378`) even though the review findings already carry file + line.
**Why it matters:** Two large user-visible losses. (a) Reviewers using `coco ui` for triage can't see or answer the actual review conversation, so they leave for the web UI at the exact moment coco should be sticky. (b) coco's flagship AI review produces per-file, per-line findings and then flattens them into a wall of text — inline comments are how humans consume review.
**Sketch:** Add `getPullRequestReviewThreads(n)` and `createPullRequestReviewComments(n, comments[])` to `ForgeActions`. GitHub: `gh api` GraphQL `reviewThreads` + REST `POST /pulls/{n}/reviews` with a `comments[]` array. GitLab: discussions API with `position`. Gitea: `POST /pulls/{n}/reviews` with `comments`. Bitbucket: `POST /pullrequests/{id}/comments` with `inline`. Render threads in the `detail` surface (new tab) and thread the findings' existing `file`/`line` into the `--comment` path in `review/handler.ts`.
**Already-there leverage:** Review findings already carry file/line (that's what `src/lib/autofix/buildPrompt.ts` consumes). The `detail` surface already has a tab model. All four runners exist. `forgeText.ts` sanitization already handles untrusted forge markdown.
**Effort notes / risks:** L — four genuinely different position/anchor models, and diff-position anchoring (side, start_line, commit sha) is the classic source of API 422s. Needs the `ForgeActions` "implement for every provider or return explicit unsupported" discipline; Bitbucket's `inline` model is the weakest and may legitimately return unsupported for multi-line ranges.

### [PRIORITY: P1] [EFFORT: L] feat(forge): Azure DevOps provider
**Category:** forge parity
**Gap:** `GitProviderType` has no `azure` member; an `dev.azure.com` or `*.visualstudio.com` remote resolves to `unsupported` (`providerData.ts:110-121`), which disables `prs`, `issues`, `pr create`, and the entire workstation triage stack.
**Why it matters:** Azure DevOps Repos is the largest forge coco doesn't support, and it dominates exactly the enterprise segment that also buys Azure OpenAI — which coco *does* support as a first-class provider. That mismatch is odd: an org can use coco's Azure LLM but not its Azure repos.
**Sketch:** Add `'azure-devops'` to `GitProviderType`, host detection for `dev.azure.com` / `*.visualstudio.com` / on-prem via `forgeHosts`, and a `src/git/azureDevOpsCli.ts` runner (PAT auth via `fetch`; no CLI binary, exactly like Bitbucket/Gitea) plus `azureDevOpsListData.ts`, `azureDevOpsDetailData.ts`, `azureDevOpsPullRequestActions.ts`, `azureDevOpsIssueActions.ts`, and an `azureDevOpsActions()` facade in `forgeActions.ts`.
**Already-there leverage:** The Gitea facade is a complete, recent, CLI-free worked example of adding a forge — same file set, same `makeXRunner(host)` pattern, same graceful-unsupported convention. `parseRemoteUrl` is already host-agnostic and `forgeHostOverrides` already supports vanity hosts.
**Effort notes / risks:** L. Azure DevOps has a genuinely different resource hierarchy (organization / project / repo, three segments where every other forge has two), which the `owner`/`name` shape of `ProviderRepository` cannot express — that's the real cost, and it may require a third optional segment threaded through `buildProviderUrl`. Work items are not issues; the `issues` mapping will be lossy and should say so.

### [PRIORITY: P1] [EFFORT: M] feat(forge): Bitbucket Server / Data Center as a distinct provider
**Category:** forge parity
**Gap:** `detectProvider` classifies *any* host containing `bitbucket` as `bitbucket`, and the Bitbucket facade is hardwired to the Cloud API base. Self-hosted Bitbucket Server/DC — a different API (`/rest/api/1.0`), different auth, different pagination — is silently routed to a cloud endpoint.
**Why it matters:** Enterprise Bitbucket is overwhelmingly Server/DC, not Cloud. Users get confusing auth failures rather than "unsupported", which is worse than no support.
**Sketch:** Add `'bitbucket-server'` to `GitProviderType`, make it selectable via the existing `forgeHosts` config override (auto-detection is not reliably possible), and add `src/git/bitbucketServerCli.ts` with a host-bound runner following `makeGiteaRunner`, plus the four data/action modules and a facade branch in `getForgeActions`.
**Already-there leverage:** `forgeHostOverrides` / `setForgeHostOverrides` already exists precisely for vanity self-hosted hosts; the Gitea host-bound-runner pattern is the template; Bitbucket Cloud's DTO mapping is a starting point even though the endpoints differ.
**Effort notes / risks:** M. Overlaps with a known bug (cloud-API misrouting for `*bitbucket*` hosts) — coordinate so the fix and the new provider don't conflict. `/rest/api/1.0` has no issues concept, so `getIssueList` should return explicit unsupported.

### [PRIORITY: P1] [EFFORT: M] feat(forge): CI checks surface with re-run and auto-merge
**Category:** forge parity
**Gap:** Checks are read-only and shallow: `statusCheckRollup` is a flat `{name, status, conclusion}[]` (GitLab collapses an entire pipeline into one synthetic row, `gitlabDetailData.ts:129-133`). No job logs, no re-run, no auto-merge/merge-when-pipeline-succeeds. `grep -rni rerun src/git` finds nothing.
**Why it matters:** "One flaky check failed, re-run it, then merge" is a daily loop that currently forces a browser trip, breaking the terminal-native promise. Auto-merge is the mechanism that makes coco's PR flow actually terminate without babysitting.
**Sketch:** Add `getPullRequestChecks(n)`, `rerunFailedChecks(n)`, and `enableAutoMerge(n, strategy)` to `ForgeActions`. GitHub: `gh run rerun --failed`, `gh pr merge --auto`. GitLab: `POST /pipelines/{id}/retry`, `merge_when_pipeline_succeeds`. Gitea: `POST /actions/runs/{id}/rerun`, `merge_when_checks_succeed`. Bitbucket: explicit unsupported for re-run. Render as a checks tab in the `detail` surface with keys in `inkKeymap.ts`.
**Already-there leverage:** `PullRequestStatusCheck` and the per-forge check mapping already exist in all four detail fetchers; the merge-strategy vocabulary (`PullRequestMergeStrategy`) is already normalized across forges; `headerChips.ts` already renders check state.
**Effort notes / risks:** M. Re-run needs a check-run→workflow-run id mapping that the current flat shape discards, so `PullRequestStatusCheck` gains an optional `runId`. Auto-merge semantics differ enough per forge (GitHub requires branch protection; GitLab requires a pipeline) that the failure messages matter more than the happy path.

### [PRIORITY: P1] [EFFORT: M] feat(issues): create issues, and AI-draft them from a diff or a review finding
**Category:** command
**Gap:** `grep -rn createIssue src/` is empty. `ForgeActions` can comment/label/assign/close/reopen an issue but not open one. `coco issues` is read + triage only.
**Why it matters:** coco already *generates* the exact content an issue needs — `coco review` produces titled, severity-scored, file-anchored findings, and the shipped autofix flow proves those findings are actionable artifacts. Not being able to file one is a dead end in a workflow coco otherwise owns end to end. It also unblocks "triage this repo" style automation without granting write access to anything but the issue tracker.
**Sketch:** Add `createIssue(input)` to `ForgeActions` (all four forges support it: `gh issue create`, `glab api POST /issues`, Bitbucket `POST /issues`, Gitea `POST /issues`). Add `src/commands/issues/createHandler.ts` behind `coco issues create` with `--title`/`--body`/`--from-review`/`-i`/`--dry-run`/`--json`, mirroring `src/commands/prCreate/` flag shape. In the TUI, add a "file issue from finding" action.
**Already-there leverage:** `src/commands/prCreate/` is a complete worked example of AI-drafted forge creation (interactive confirm, `--dry-run`, `--json`, web fallback); review findings are already structured; `runPullRequestBodyWorkstation` in `aiActions.ts` shows the body-generation pattern.
**Effort notes / risks:** M. Forge mutation, so it must go through the adapter. Explicitly **must not** be exposed as an MCP tool — that would violate the "MCP generation tools remain repository-read-only, no forge mutations" invariant.

### [PRIORITY: P1] [EFFORT: M] feat(mcp): expose resources and prompts primitives, not just tools
**Category:** agent-mcp
**Gap:** `src/mcp/server.ts` registers four tools (`server.registerTool` in a loop over the agent operations) and nothing else — no `registerResource`, no `registerPrompt`. Clients can only *call* coco; they cannot *browse* repository context or reuse coco's prompt library.
**Why it matters:** Tools are the imperative surface; resources and prompts are the discoverable ones. An MCP client that could read `coco://repo/status`, `coco://repo/diff/staged`, or `coco://repo/branch-context` as resources would stop burning tool calls on context gathering, and exposing coco's commit/review prompt templates as MCP prompts turns coco into a prompt provider for any agent — a genuinely differentiating position that no other git MCP server holds.
**Sketch:** In `src/mcp/server.ts`, add `server.registerResource` entries backed by the existing read-only loaders in `src/operations/agent/context.ts` (status, staged diff, branch context, recent log), and `server.registerPrompt` entries wrapping the `prompt.ts` templates from `src/commands/{commit,review,changelog,recap}/`. Both are read-only by construction, so the invariant holds trivially.
**Already-there leverage:** Root confinement, repo normalization, and the client-roots resolution (`getClientCapabilities()?.roots` / `listRoots()`) are already implemented and tested in `server.ts`. `src/operations/agent/context.ts` already produces exactly the read-only context payloads a resource would serve, with SHA-256 provenance.
**Effort notes / risks:** M. Resource URI design is the only real decision. Must keep `telemetry.usage` metadata-only semantics for resource reads, and must not let a resource URI become a per-call repo switch (explicitly forbidden). Outside the #1822–#1830 set, which is all tools/docs.

### [PRIORITY: P1] [EFFORT: M] feat(mcp): progress notifications and streaming for long generations
**Category:** agent-mcp
**Gap:** MCP tool calls are single-shot request/response. A `coco_review` over a large diff fans out into many summarization calls (see `summarizeDiffs.ts` wave scheduling) and the client sees nothing until it completes. No `notifications/progress`, no partial results.
**Why it matters:** Agent clients time out or double-fire on long calls. coco's own TUI already solved this problem for humans — `service.streaming.enabled` streams the commit draft token-by-token with `AbortController` cancel — so the machine surface is behind the human one on the same underlying capability.
**Sketch:** Thread a `progressToken` from the MCP request into `src/operations/agent/generate.ts` and emit `notifications/progress` at the existing stage boundaries in the diff-condensing pipeline. Reuse `executeChainStreaming` where a single call dominates. Keep the terminal envelope shape byte-identical so non-progress-aware clients are unaffected.
**Already-there leverage:** `executeChainStreaming` + `AbortController` cancellation already exist and are already wired through the agent operation layer; the parser pipeline already has discrete wave/stage boundaries that are natural progress points; the MCP SDK supports progress natively.
**Effort notes / risks:** M. The `src/operations/agent/` layer must stay transport-agnostic — progress emission has to be injected as a callback from `src/mcp/`, not imported into operations, or the shared-operations invariant breaks. Also outside #1822–#1830.

### [PRIORITY: P1] [EFFORT: M] feat(workstation): mouse support (click-to-focus, wheel scroll, click-to-select)
**Category:** tui
**Gap:** Documented as a deliberate non-feature: "The TUI is keyboard-only by design ... No mouse input is consumed" (`src/workstation/runtime/app.ts:23-25`). No SGR mouse-mode enable anywhere.
**Why it matters:** lazygit, gitui, and tig all consume mouse events. The keyboard-first design is right; keyboard-*only* costs new users their first five minutes — wheel-scrolling a long diff and clicking a pane to focus it are muscle memory. This is the most common first-impression complaint class for dense TUIs, and it is additive: no existing binding changes.
**Sketch:** Enable SGR mouse reporting (`?1006h`/`?1000h`) in `src/workstation/chrome/terminalLifecycle.ts` behind `ui.mouse: true` (default off for one release), parse the escape sequences in `src/workstation/runtime/inkInput.ts` alongside key events, and map to three actions only: pane focus, list-row select, and scroll. Extend `LOG_INK_KEY_BINDINGS`-adjacent docs in `KEYMAP.md`.
**Already-there leverage:** `terminalLifecycle.ts` already owns alt-screen enter/exit, so mouse-mode enable/disable has a correct home with guaranteed teardown. `layout.ts` already computes pane rectangles, which is exactly the hit-testing input. `selectionRectify.ts` already normalizes selection changes from arbitrary sources.
**Effort notes / risks:** M. Mouse mode breaks terminal text selection unless shift-override is documented; teardown must be bulletproof or a crash leaves the user's terminal in mouse mode (mitigated by `terminalLifecycle`'s existing cleanup path). Touches `inkInput.ts`, which #1722 is extracting — sequence after that lands.

### [PRIORITY: P1] [EFFORT: M] feat(workstation): undo stack for destructive git actions
**Category:** tui
**Gap:** `grep -rni "undoStack|redoStack" src/` is empty. The workstation exposes one-keystroke destructive operations across `branches` (delete), `stash` (drop), `history` (reset), `tags` (delete), and `pullRequestTriage` (close) with no unified undo. There *is* a `reflog` surface, but it is a browser, not an undo affordance.
**Why it matters:** Key-dense TUIs make mistakes cheap to commit and expensive to reverse; `KEYMAP.md` itself flags overload risk as a live hazard. The safety net is what lets users trust the density. magit's and lazygit's undo affordances are a big part of why users forgive their key density.
**Sketch:** Add `src/workstation/runtime/undoStack.ts` — a bounded in-session stack where each destructive action pushes `{ label, inverse }` (branch delete → recreate at recorded sha; stash drop → `git stash store` the recorded sha; reset → reset back to the recorded HEAD; tag delete → recreate). Capture the pre-state in the existing action hooks under `runtime/hooks/`, bind `gu` (the `g`-chord namespace is already the "global/meta" space), and surface the stack in the footer.
**Already-there leverage:** `reflogActions.ts` + `reflogData.ts` already resolve prior positions, which is most of the inverse-operation data. The `g`-chord dispatch layer and the collision-guard test (`inkKeymap.collisions.test.ts`) make adding a safe binding mechanical. `postApplyHints.ts` is already the place that tells users what just happened.
**Effort notes / risks:** M. Not every action is invertible — the stack must record only actions with a real inverse and say so, rather than promising universal undo. Must not present itself as undo for pushed history. Session-scoped only; persisting it is a separate question.

### [PRIORITY: P1] [EFFORT: M] feat(blame): `coco blame --explain` — attribute a line and explain why it changed
**Category:** command
**Gap:** `src/git/blameData.ts` and a `blame` workstation surface exist, but blame is TUI-only (no `blame` entry among the 20 commands mounted in `src/index.ts`) and purely mechanical — it reports who and when, never why.
**Why it matters:** "Who wrote this and what were they thinking" is the single most common code-archaeology question, and it is precisely where an LLM adds something git cannot: reading the introducing commit, its neighbours, and the linked PR, then explaining intent. This is a differentiating bet rather than a parity fix — no other git CLI ships it, and coco already has every input.
**Sketch:** New `src/commands/blame/{config,index,handler,prompt}.ts` — `coco blame <file> [--lines a:b] [--explain] [--json]`. Non-explain mode renders `blameData.ts` output. `--explain` resolves each blame sha's full commit via `logData.ts`, optionally the PR that merged it via `ForgeActions`, and asks for a per-range intent summary. Add an `E` binding to the blame surface for the same in-TUI.
**Already-there leverage:** `blameData.ts`, `fileHistoryData.ts`, `logData.ts`, the blame surface, and the forge adapter for PR lookup are all shipped. A new `blameExplain` dynamic-model task slots into the existing `DynamicModelTask` table.
**Effort notes / risks:** M. Cost control matters — a naive implementation makes one LLM call per blame sha; batch by introducing-commit and cap the range. Fits the layering cleanly (`git` data → `commands` handler).

### [PRIORITY: P1] [EFFORT: M] feat(provider): promote prompt caching and reasoning effort to typed config
**Category:** provider
**Gap:** Both are reachable only through `service.fields` (`Object.assign(anthropicConfig, config.service.fields)`), so they are undiscoverable, unvalidated, absent from `schema.json`, and invisible to `doctor`. Nothing reads cache-hit usage metadata back — `UsageRecord` has no cached-token field.
**Why it matters:** Prompt caching is the largest single cost lever available to coco's workload: the same system prompt and often the same diff summaries are resent across `commit`, `review`, and `changelog` in one session. Reasoning effort is the quality/cost dial users most want on `review` and `commitSplit`. Both are currently invisible.
**Sketch:** Add `service.promptCache?: boolean` and `service.reasoningEffort?: 'minimal'|'low'|'medium'|'high'` to `src/lib/config/types.ts`; translate per provider in `providers/{anthropic,openai,azure,gemini,bedrock}.ts` (Anthropic `cache_control` breakpoints on the system block; OpenAI/Azure `reasoning_effort`; Gemini `thinkingConfig`), gated by a new `supportsPromptCache` / `supportsReasoningEffort` flag on `ProviderDefinition`. Record `cachedInputTokens` in `usageLedger.ts` and report hit-rate in `doctor --cost`. Regenerate `schema.json`.
**Already-there leverage:** `ProviderDefinition` is the established home for per-provider capability facts; `DEFAULT_MAX_OUTPUT_TOKENS` shows the shared-default pattern; the observability layer already reads provider usage metadata for token counts, so cached-token extraction is the same code path.
**Effort notes / risks:** M. Cache breakpoints must go on the stable prefix or they cost more than they save — needs prompt-template awareness, which is why this is M not S. Pairs naturally with the P0 cost work; ship pricing first so the win is measurable.

### [PRIORITY: P1] [EFFORT: M] feat(distribution): Scoop / winget / AUR / Nix packaging plus a stale-version notice
**Category:** distribution
**Gap:** `packaging/` holds only `packaging/homebrew/coco.rb`, and `update-homebrew-tap.yml` is the only packaging fanout. `install.sh` requires Node 22+ and npm. No self-update or new-version notice exists (`grep -rni "self-update|update-notifier|latestVersion" src bin` is empty), and `--version` prints a bare string with no `--json`.
**Why it matters:** CI already runs a Windows matrix cell, so Windows users are an acknowledged constituency with no native install path. Linux users get no distro package. And because there is no update notice, users sit on old versions indefinitely — which matters unusually much here, since `dynamicModels.ts` pins model ids that *retire* (the file's own comments record gpt-4.1 and claude-3.5 defaults starting to 404). A stale coco silently breaks.
**Sketch:** Extend `bin/genHomebrewFormula.mjs` into a manifest generator covering a Scoop bucket, a winget manifest, a PKGBUILD, and a Nix flake; fan out from `publish-release.yml` the way the Homebrew tap update already does. Add `--version --json` (version, node, platform, resolved provider — `src/lib/buildInfo.ts` already carries `BUILD_VERSION`) and a cached once-daily registry check that prints a one-line notice, off under `--quiet`/non-TTY and disableable via config.
**Already-there leverage:** `genHomebrewFormula.mjs` + `verifyRelease.mjs` + `update-homebrew-tap.yml` are a complete release-fanout precedent; `src/lib/buildInfo.ts` is generated at build time; `src/workstation/chrome/jsonStore.ts` gives a cache primitive for the last-checked timestamp.
**Effort notes / risks:** M, mostly per-ecosystem tedium and review latency (winget/AUR need external submissions). The version check must never block a command, never run under `--json`/`--quiet`/CI, and must be opt-out — a chatty CLI is worse than a stale one.

---

# P2 — worthwhile, lower urgency

### [PRIORITY: P2] [EFFORT: L] feat(stack): stacked-branch / stacked-PR support
**Category:** command
**Gap:** No notion of a branch stack. `grep -rni "stacked|prStack"` finds only history *row rendering* modes and `repoStackRuntime.ts` (multi-repo navigation, unrelated). `ForgeActions.createPullRequest` takes a single `base`, and nothing tracks parent/child relationships or restacks children after a parent rebase.
**Why it matters:** Stacked development is where Graphite, `git-town`, and `spr` have carved out real adoption, and it is a workflow AI helps with disproportionately — decomposing a large change into a stack is exactly what `commit --split` already does one level down. This is the most differentiating bet in this report.
**Sketch:** Add `src/git/stackData.ts` + `stackActions.ts` storing parent pointers in git config (`branch.<name>.coco-parent`, no new files, survives clone-independently), a `stack` workstation surface, and `coco stack {create,restack,submit,status}` where `submit` walks the stack calling `ForgeActions.createPullRequest` with each branch's parent as base. Reuse `commitSplit` planning to propose a stack from a large working set.
**Already-there leverage:** `branchData.ts`/`branchActions.ts`, `rebaseActions.ts`/`rebasePlanActions.ts`, `worktreeActions.ts`, the split planner, and the multi-row surface pattern are all shipped. `configFiles.ts` already reads/writes git config sections.
**Effort notes / risks:** L and genuinely risky — restack-after-rebase is where every stacking tool accumulates its bug reports, and conflict handling mid-restack must integrate with the (currently unimplemented) `coco resolve` work. Sequence after P0-1. Large new surface area for the keymap.

### [PRIORITY: P2] [EFFORT: M] feat(workstation): `git notes` and sparse-checkout awareness
**Category:** tui
**Gap:** `grep -rni "git notes|sparse-checkout" src/` returns nothing. There is no notes read/write and no indication when the working tree is a partial checkout. (LFS *is* handled — `lfsAttributes.ts`, `lfsPointer.ts` — and submodules have a surface plus `submoduleDiff.ts`, so this is the remaining pair.)
**Why it matters:** Notes are how teams attach review metadata and CI provenance to commits without rewriting them; a git client that hides them hides data. Sparse-checkout matters more: in a sparse cone, `status` and `diff` legitimately omit paths, and a UI that doesn't say so looks like it lost the user's files.
**Sketch:** `src/git/notesData.ts` + `notesActions.ts` (`git notes list/show/add`), rendered as a `detail` surface tab with an add/edit action. For sparse: read `core.sparseCheckout` / `.git/info/sparse-checkout` in `src/git/statusData.ts` and surface a header chip via `headerChips.ts` plus an empty-state hint in `surfaceStates.ts`.
**Already-there leverage:** The `detail` surface tab model, `headerChips.ts`, and `surfaceStates.ts` empty-state copy pipeline all exist. `lfsAttributes.ts` is the precedent for "read a git config/attributes fact and reflect it in chrome."
**Effort notes / risks:** M. Notes refs are easy to get wrong across `refs/notes/*` namespaces; scope v1 to `refs/notes/commits`. The sparse-checkout half is closer to S and could ship first.

### [PRIORITY: P2] [EFFORT: M] feat(watch): `coco watch` — continuous review and commit-draft daemon
**Category:** command
**Gap:** No watch mode anywhere. `src/workstation/chrome/refreshWatcher.ts` watches the repo, but only to refresh the TUI.
**Why it matters:** The pre-commit-review idea in #1370 is one-shot and TUI-bound. A standing `coco watch --review` that reviews each save-quiesced change set, or `--draft` that keeps a commit message current as you stage, turns coco from a command you remember to run into ambient feedback. Natural companion to the editor-extension direction.
**Sketch:** New `src/commands/watch/{config,index,handler}.ts` reusing `refreshWatcher`'s debounce/quiesce logic (extracted down into `src/lib/` to respect layering — `commands` may not import from `workstation`). Re-run `review`/`commit-draft` through `src/operations/agent/` on each settled change, with a diff-hash guard so an unchanged tree never triggers a call. `--json` line-delimited output for editor consumption.
**Already-there leverage:** `refreshWatcher.ts` already solves rename-survival and debounce (with a documented flaky test to inherit carefully); `src/operations/agent/generate.ts` is already the reusable non-interactive generation entry point; `diffSummaryCache.ts` gives cheap change detection.
**Effort notes / risks:** M. Cost containment is the whole design problem — a watch loop that fires an LLM call per keystroke is a bill. Requires the hash guard, a min-interval, and ideally the P0 budget cap landing first. The `refreshWatcher` extraction must move *down* into `lib/`, never sideways.

### [PRIORITY: P2] [EFFORT: S] feat(agent): read `AGENTS.md` / steering files as a first-class context source
**Category:** agent-mcp
**Gap:** `src/operations/agent/context.ts` assembles diff/status/branch context. Nothing reads `AGENTS.md`, `CLAUDE.md`, `.kiro/steering/**`, or `CONTRIBUTING.md` — so coco's own generation has no access to the house style that this very repo documents for other agents.
**Why it matters:** The most common complaint about AI commit messages and reviews is that they ignore project conventions. Every convention coco needs is already written down in a conventional location. It is also pleasingly self-referential: coco would follow its own `AGENTS.md` "House style" section.
**Sketch:** Add `resolveProjectConventions(root)` to `src/operations/agent/context.ts` — read a bounded allowlist of paths, truncate to a token budget, hash for provenance — and thread the text into the `commit`/`review`/`changelog` prompt templates as a new `conventions_context` variable (exactly how `language_context` and `branch_name_context` already degrade to `''` when absent).
**Already-there leverage:** `languageContext.ts` is the precise template for an optional prompt-variable helper. The agent layer already computes SHA-256 provenance for supplied context, which is what makes trusting a repo file auditable. `enforcePromptBudget` already handles truncation.
**Effort notes / risks:** S, but it brushes a real invariant: MCP tools deliberately do **not** execute repository-defined prompts (`server.ts:141,175`). Reading a markdown file as *context* is not executing a prompt, but it is repository-controlled text entering the prompt — so it must be gated behind the existing `trustRepositoryConfig` flag (already threaded for `config.language` at `generateCommitDraft.ts:297`) and default off for MCP.

### [PRIORITY: P2] [EFFORT: M] feat(i18n): take `language` beyond a one-sentence prompt hint
**Category:** distribution
**Gap:** `language` is implemented entirely by `getLanguageContext` (`src/lib/langchain/utils/languageContext.ts`), which returns the single sentence "Write the {task} in {language}." Only four handlers consume it (`commit`, `changelog`, `recap`, `review`) — `amend` does not, despite writing a commit message. All CLI chrome, `--help` text, error messages, TUI labels, footer hints, help overlay, idle tips, and `surfaceStates.ts` empty-state copy are hardcoded English.
**Why it matters:** The config key advertises localization the product doesn't have. A non-English team gets Spanish commit messages inside an entirely English UI, and gets English again the moment they run `amend`. Either deepen it or scope the key honestly.
**Sketch:** Two separable issues. (1) **Consistency (S):** thread `getLanguageContext` through `src/commands/amend/handler.ts` and any other generating handler, and add a test asserting every generation handler consumes it. (2) **UI locale (M):** introduce `src/lib/i18n/` with a flat message catalog, migrate the highest-value strings first (`surfaceStates.ts`, `inkKeymap.ts` footer hints, help overlay sections, `aiErrors.ts`), keep English as the fallback, and add a lint rule against new inline user-facing literals in those files.
**Already-there leverage:** Empty-state and error copy is already centralized (`surfaceStates.ts`, `aiErrors.ts`, `idleTips.ts`, `forgeNouns.ts`) — the hard consolidation work is done, which is what makes catalog extraction tractable at all.
**Effort notes / risks:** Part 1 is S and should ship immediately as a standalone parity fix. Part 2 is M and will collide with every render snapshot test; it also affects fixed-width TUI layout, since translated strings are longer — `layout.ts` width budgeting assumes English lengths.

### [PRIORITY: P2] [EFFORT: S] feat(observability): report diff-summary cache hit rate in `doctor --cost`
**Category:** observability
**Gap:** `src/lib/parsers/default/utils/diffSummaryCache.ts` has `readDiffSummary`, `writeDiffSummary`, and a `touchDiffSummary` whose docblock literally says it runs "when a read returned a hit" — the hit signal exists and is discarded. `doctor --cost` reports calls, tokens, and latency, never cache effectiveness. `coco cache` manages the cache without measuring it.
**Why it matters:** The cache is the second-biggest cost lever after prompt caching, and nobody can tell whether it's working. A user whose cache is thrashing (because they run from varying subdirectories, or their model id keeps changing, both of which change the cache key via `diffSummaryKey(diff, model, promptHash)`) has no signal at all — and the file's own comments record that a subdirectory-related cache-miss bug already happened once.
**Sketch:** Add an optional `cacheHit?: boolean` to `UsageRecord` in `usageLedger.ts`, set it where the parser consults `readDiffSummary`, aggregate as a hit-rate column in `summarizeUsageByTask`, and render it in `doctor/handler.ts`. Add "cache hit rate below X%" as a `doctor/checks.ts` warning with a fix hint.
**Already-there leverage:** Hit/miss is already known at the call site; `UsageRecord` is already an append-only metadata-only line format that tolerates new optional fields (`surface` was added the same way, with a documented back-compat default); the aggregation and rendering pipeline needs one more column.
**Effort notes / risks:** S. A boolean is metadata, so the read-only/no-content telemetry invariant holds. Ship alongside the P0 cost work so `doctor --cost` grows once, not twice.

### [PRIORITY: P2] [EFFORT: M] feat(forge): CODEOWNERS awareness and required-reviewer surfacing
**Category:** forge parity
**Gap:** `grep -rni CODEOWNERS src/` returns nothing. `reviewDecision` — the field that would carry required-review state — is hard-coded `undefined` on GitLab, Bitbucket, and Gitea (`gitlabListData.ts:177,314`, `bitbucketListData.ts:144`, `giteaListData.ts:127`), so even the read-only signal only works on GitHub.
**Why it matters:** "Who must approve this, and are they blocking?" decides whether a PR row in triage is actionable. Without it, `coco ui`'s triage view ranks a PR that needs one specific reviewer identically to one that needs nothing. On three of four forges coco can't even say whether review is satisfied.
**Sketch:** Two halves. (a) `src/git/codeowners.ts` — parse `.github/CODEOWNERS` / `CODEOWNERS` / `docs/CODEOWNERS` with `minimatch` (already a dependency) and map changed paths to owners; surface owners in the `pullRequest` and `diff` surfaces and as a `pr create` reviewer suggestion. (b) Populate `reviewDecision` for the other three forges: GitLab approval rules (`/approval_state`), Gitea `/reviews`, Bitbucket participant approvals — the raw data is already fetched by the detail fetchers, just not normalized into the list row.
**Already-there leverage:** `minimatch` is a dependency; `pullRequestDetailData.ts` and its three siblings already fetch approval/review payloads for the inspector, so half of (b) is a normalization pass over data already in memory. `headerChips.ts` already renders review state for GitHub.
**Effort notes / risks:** M. CODEOWNERS is a deceptively fiddly format (ordering, negation, team handles that can't be resolved without an API call) — v1 should resolve patterns and show raw handles without expanding teams. Populating `reviewDecision` per forge must keep the GitHub vocabulary as the normalized target so surfaces stay provider-blind.

---

## Suggested sequencing

1. **Immediately:** P0-6 (bench CI gate, S) and P0-2 (draft→ready, S) — days, not weeks, and both are visible.
2. **Then the money cluster:** P0-3 (dollar cost + budgets) → P0-4 (structured output) → P1 prompt caching → P2 cache hit rate. Land pricing first so every subsequent win is measurable in the same units.
3. **Then the flagship:** P0-1 (`coco resolve`) as ~4 sequenced PRs against the existing spec.
4. **Then forge parity:** P0-7 (Bitbucket diffs) → P1 checks/auto-merge → P1 review threads → P1 Azure DevOps / Bitbucket Server.
5. **Defer:** P2-1 (stacks) until `coco resolve` exists, since restack conflict handling depends on it.
