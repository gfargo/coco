import { z } from 'zod'

export const CommitSplitPlanSchema = z.object({
  groups: z
    .array(
      z
        .object({
          title: z.string().min(1),
          body: z.string().optional(),
          rationale: z.string().optional(),
          // Both optional: the model legitimately emits a group with *either*
          // `files` or `hunks` (a file-level vs hunk-level grouping), not always
          // both. Requiring both made Zod throw "Required" and the whole split
          // chain failed to parse before the refine could run. The refine below
          // still enforces "at least one", and every downstream consumer already
          // reads these as `group.files || []`. (Kept `.optional()` rather than
          // `.default([])` so the schema's input and output types stay identical
          // — `executeChainWithSchema` takes a `z.ZodSchema<T>`, which requires
          // that.)
          files: z.array(z.string()).optional(),
          hunks: z.array(z.string()).optional(),
          // Internal flag (not emitted by the model). Set by
          // `rescueMissingFiles` on the catch-all group of files the
          // plan didn't confidently place: the apply step skips
          // committing these, leaving them in the worktree for the user
          // to handle, and the review overlay renders them as a "will
          // stay — not committed" note rather than a numbered commit
          // (#1180).
          unclaimed: z.boolean().optional(),
        })
        .refine(
          (group) =>
            (group.files?.length ?? 0) > 0 || (group.hunks?.length ?? 0) > 0,
          {
            message: 'Each group must include at least one file or hunk',
          }
        )
    )
    .min(1),
})

export type CommitSplitPlan = z.infer<typeof CommitSplitPlanSchema>
export type CommitSplitGroup = CommitSplitPlan['groups'][number]
