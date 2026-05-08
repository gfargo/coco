import { z } from 'zod'

export const CommitSplitPlanSchema = z.object({
  groups: z
    .array(
      z
        .object({
          title: z.string().min(1),
          body: z.string().optional(),
          rationale: z.string().optional(),
          files: z.array(z.string()),
          hunks: z.array(z.string()),
        })
        .refine((group) => group.files.length > 0 || group.hunks.length > 0, {
          message: 'Each group must include at least one file or hunk',
        })
    )
    .min(1),
})

export type CommitSplitPlan = z.infer<typeof CommitSplitPlanSchema>
export type CommitSplitGroup = CommitSplitPlan['groups'][number]
