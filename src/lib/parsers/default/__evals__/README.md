# `__evals__/` — structural-extract eval harness

Scaffolding for #934. Measures the structural-extract fast path's
behavior (regex extractors today, tree-sitter when that lands) by
running the parser pipeline twice against a fixed input set — once
with `fastPath.languageAware.enabled: false` (LLM baseline), once
with it on — and reporting LLM-calls-saved, fast-path hit count, and
token deltas per file.

## Why this exists

Unit tests of the individual extractors (`tsStructuralDiff.test.ts`
et al.) verify that `parseStructuralLine('export function foo() {}')`
returns the right symbol. They don't verify the *resulting commit
message* is still good when the fast path fires. Without an eval
harness:

- We can't ship `languageAware.enabled: true` as the default with
  confidence — it stays opt-in.
- We can't compare tree-sitter vs. regex quantitatively (#933).
- Extractor regressions are invisible until a user complains.

The harness produces a deterministic, mechanical signal: did the
fast path fire? did the LLM call go away? It doesn't yet judge
"is the resulting message better" — that's a separate axis
(human review, eventually a real-LLM live-mode harness).

## Layout

```
__evals__/
├── README.md                  (this file)
├── structuralExtractEval.ts   (the A/B harness)
├── structuralExtractEval.test.ts
├── scenarioInputs.ts          (scenario → FileDiff[] adapter)
├── scenarioInputs.test.ts
└── fixtures.ts                (hand-crafted modification diffs)
```

The CLI driver lives at `bin/structuralExtractEval.ts` and is wired
via the `eval:structural-extract` npm script.

## Inputs

The eval consumes two input sources:

1. **Scenarios** (`scenarioInputs.ts`). Each scenario in the
   ``@gfargo/git-scenarios`` library is materialized into a temp
   repo, then its commits are walked and converted to `FileDiff[]`.
   Mostly trigger the lossless trivial-shape short-circuit (pure
   additions); useful for measuring the natural distribution.

2. **Fixtures** (`fixtures.ts`). Hand-crafted modification diffs that
   specifically target the language-aware path. One fixture per
   language so a regression in any single extractor surfaces in its
   own outcome row rather than being averaged out.

Both are deterministic — same input set across runs, same machine or
not. That's what makes the harness suitable for regression detection
even without a committed baseline.

## Running

```bash
npm run eval:structural-extract                       # scenarios + fixtures
npm run eval:structural-extract -- --fixtures-only    # fast path coverage only
npm run eval:structural-extract -- --no-fixtures      # scenarios only
npm run eval:structural-extract -- --scenario NAME    # one scenario
npm run eval:structural-extract -- --languages ts,js  # narrow opt-in
npm run eval:structural-extract -- --out DIR          # custom output
```

Output lands in `.bench/structural-extract-eval/<timestamp>/`:

- `scenario-<name>.json` / `scenario-<name>.md`
- `fixture-<name>.json` / `fixture-<name>.md`

The aggregate summary prints to stdout.

## Reading the report

Each report has two sections:

1. **Per-run totals** — LLM calls fired, input/output tokens for each
   config.
2. **Deltas vs baseline** — LLM calls saved, token reduction
   (informational; can be positive OR negative since templated
   summaries differ in length from LLM mocks), fast-path hit count.

The load-bearing metric for #934 is `llmCallsSaved`. Token reduction
is reported for completeness but isn't asserted with a sign — the
templated summary can be longer or shorter than the mock LLM summary
depending on input shape.

## What's NOT here (yet)

- **Committed baseline + regression check**. Today the harness reports
  one-run output; comparing run-to-run for CI gating is a follow-up.
  The pattern from `.bench/baseline.json` (#845) is the template.
- **Real-LLM live mode**. Mock-mode is fast + deterministic + free;
  real-LLM eval is slow + paid + non-deterministic, but lets us
  compare actual generated messages side-by-side. Layer it onto the
  existing harness via a `mode: 'mock' | 'live'` option when the cost
  is justified.
- **Rust / Go fixture generators**. The `__fixtures__/generators.ts`
  module only covers TS + Python today. Scenario coverage for Rust /
  Go languages is purely zero-modification (the deterministic
  generator defaults to TypeScript). Hand-crafted Rust/Go fixtures
  in `fixtures.ts` partially compensate.
- **Per-language breakdown**. Aggregate metrics are by-scenario today;
  a per-language pivot ("Python fast-path coverage = X%") would help
  prioritize extractor work. Easy to add once the harness has a
  consumer asking for it.

## Adding a fixture

Append to `fixtures.ts`. Keep it focused — one structural change per
fixture (added export, removed function, signature change). The
fixture's `diffs` array is fed directly into the harness, so it
needs to be a realistic unified-diff body for a single file.

```ts
{
  name: 'ts-something-new',
  description: 'What this exercises.',
  diffs: [
    buildDiff('src/something.ts', [
      '@@ -1,2 +1,2 @@',
      '-export function before() {}',
      '+export function after() {}',
    ].join('\n')),
  ],
},
```

Then re-run the eval — the new fixture appears in the output. No
registration step.
