import { ReviewFeedbackItem } from '../review/config'

export function findingToIssue(finding: ReviewFeedbackItem): { title: string; body: string } {
  return {
    title: finding.title,
    body: `${finding.summary}\n\n- Severity: ${finding.severity}\n- Category: ${finding.category}\n- File: \`${finding.filePath}\``,
  }
}
