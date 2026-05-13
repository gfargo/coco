/**
 * Hand-crafted eval fixtures for the structural-extract harness (#934).
 *
 * These complement the scenario-derived inputs in `scenarioInputs.ts`:
 *
 *   - **Scenarios** measure the natural distribution. Most scenario
 *     commits are pure additions, which hit the lossless trivial-shape
 *     short-circuit BEFORE the language-aware path runs — useful for
 *     showing what the fast path doesn't need to do.
 *
 *   - **Fixtures** (this file) are modification-shaped commits that
 *     DO reach the language-aware branch, so the eval can report a
 *     non-zero fast-path hit rate. Each fixture is a small, focused
 *     case that exercises one language's extractor against a realistic
 *     diff shape.
 *
 * Adding a fixture: append to `evalFixtures`. Keep them small and
 * focused — one structural change per fixture (added export, removed
 * function, signature change, etc.) — so a regression in any single
 * extractor surfaces visibly in the per-fixture outcome rather than
 * being averaged out.
 */

import type { FileDiff } from '../../../types'

export type EvalFixture = {
  /** Stable identifier — appears in the per-fixture outcome row. */
  name: string
  /** What this fixture is meant to exercise. */
  description: string
  /** The diffs the eval feeds into the parser. */
  diffs: FileDiff[]
}

function buildDiff(file: string, diff: string): FileDiff {
  return { file, diff, summary: '', tokenCount: Math.ceil(diff.length / 4) }
}

export const evalFixtures: readonly EvalFixture[] = [
  {
    name: 'ts-export-add-remove',
    description: 'TS module gains parseRequest, loses legacyParse — both top-level exports.',
    diffs: [
      buildDiff('src/parser.ts', [
        '@@ -1,8 +1,12 @@',
        ' import { Logger } from "./logger"',
        ' ',
        '-export function legacyParse() {',
        '-  return {}',
        '-}',
        '+export function parseRequest(input: string) {',
        '+  return JSON.parse(input)',
        '+}',
        '+',
        '+export const PARSE_VERSION = 2',
        ' ',
        ' export class ParserContext {',
        '   constructor(private readonly log: Logger) {}',
        ' }',
      ].join('\n')),
    ],
  },
  {
    name: 'ts-signature-change',
    description: 'TS function gains a parameter — both buckets carry parseRequest, surfaces as signature change.',
    diffs: [
      buildDiff('src/parser.ts', [
        '@@ -1,4 +1,4 @@',
        ' import { Logger } from "./logger"',
        ' ',
        '-export function parseRequest(input: string) {',
        '+export function parseRequest(input: string, schema: Schema) {',
        '   return JSON.parse(input)',
        ' }',
      ].join('\n')),
    ],
  },
  {
    name: 'python-class-method-add',
    description: 'Python module replaces a legacy helper with a class + factory.',
    diffs: [
      buildDiff('src/handler.py', [
        '@@ -1,8 +1,14 @@',
        ' import json',
        ' ',
        '-def legacy_handler(log):',
        '-    return {"log": log}',
        '+class RequestHandler:',
        '+    def __init__(self, log):',
        '+        self._log = log',
        '+',
        '+def build_handler(log):',
        '+    return RequestHandler(log)',
        ' ',
        ' TIMEOUT = 30',
      ].join('\n')),
    ],
  },
  {
    name: 'rust-impl-block',
    description: 'Rust file replaces a legacy fn with a struct + impl block + trait impl.',
    diffs: [
      buildDiff('src/widget.rs', [
        '@@ -1,8 +1,16 @@',
        ' use crate::base::Base;',
        ' ',
        '-pub fn legacy_widget() -> &str { "old" }',
        '+pub struct Widget;',
        '+',
        '+impl Widget {',
        '+    pub fn new() -> Self { Widget }',
        '+}',
        '+',
        '+impl Base for Widget {',
        '+    fn name(&self) -> &str { "widget" }',
        '+}',
        ' ',
        ' pub const VERSION: u32 = 2;',
      ].join('\n')),
    ],
  },
  {
    name: 'go-method-receiver',
    description: 'Go file replaces a free function with a struct + constructor + method.',
    diffs: [
      buildDiff('widget.go', [
        '@@ -1,6 +1,12 @@',
        ' package widget',
        ' ',
        '-func LegacyName() string { return "old" }',
        '+type Widget struct {',
        '+    name string',
        '+}',
        '+',
        '+func New(name string) *Widget { return &Widget{name: name} }',
        '+',
        '+func (w *Widget) Name() string { return w.name }',
        ' ',
        ' const Version = 2',
      ].join('\n')),
    ],
  },
  {
    name: 'markdown-structural',
    description: 'Markdown doc gains and removes heading-level sections.',
    diffs: [
      buildDiff('docs/intro.md', [
        '@@ -1,8 +1,10 @@',
        ' # Intro',
        ' ',
        '-## Old section',
        '-Some old prose.',
        '+## New section',
        '+New prose explaining the new section.',
        ' ',
        ' ## Keep me',
        ' I stay.',
        '+',
        '+## Bonus section',
        '+More prose.',
      ].join('\n')),
    ],
  },
  {
    name: 'ts-body-only-fallthrough',
    description: 'TS file with body-only edits — no top-level signal, falls through to LLM.',
    diffs: [
      buildDiff('src/util.ts', [
        '@@ -1,5 +1,5 @@',
        ' export function compute(x: number) {',
        '-  return x * 2',
        '+  return x * 3',
        ' }',
        ' ',
        ' export const TAG = "util"',
      ].join('\n')),
    ],
  },
]
