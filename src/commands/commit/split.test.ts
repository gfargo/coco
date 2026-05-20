/**
 * Tests pinning the structural contract of the COMMIT_SPLIT_PROMPT
 * template. The full prompt text is too long to snapshot wholesale,
 * but a few key rules are load-bearing for the planner's output
 * quality — losing them silently would degrade results in ways that
 * only show up in eval runs days later. These tests catch the
 * regression at the boundary.
 */
import { COMMIT_SPLIT_PROMPT } from './split'

describe('COMMIT_SPLIT_PROMPT', () => {
  // The langchain PromptTemplate exposes the raw template string on
  // `.template`. Type it as unknown then narrow so we don't rely on
  // a runtime cast inside individual assertions.
  const template = String((COMMIT_SPLIT_PROMPT as unknown as { template: string }).template)

  describe('structural rules block', () => {
    it('declares the every-file-exactly-once rule', () => {
      expect(template).toMatch(/Every staged file MUST be assigned exactly once/)
    })

    it('forbids mixing file-mode and hunk-mode for one file', () => {
      expect(template).toMatch(/NEVER mix the two modes for the same file/)
    })

    it('requires complete hunk coverage when a file is split by hunks', () => {
      expect(template).toMatch(/you MUST assign EVERY hunk for that file/)
    })

    it('restricts hunk IDs to those listed in the inventory', () => {
      expect(template).toMatch(/Only use hunk IDs LITERALLY copied/)
    })

    it('prefers 2-5 commits as the default group count', () => {
      expect(template).toMatch(/Prefer 2-5 commits/)
    })

    // Pin the dependency-ordering rule. The applier commits in array
    // order, so this rule is what makes the resulting git history
    // read in the order the code was logically built — foundational
    // changes first, consumers after. Losing this bullet would
    // silently degrade output quality for any split where two
    // groups depend on each other.
    it('asks the planner to order groups by logical dependency', () => {
      expect(template).toMatch(/Order the groups in the sequence they would logically be built/)
      expect(template).toMatch(/foundational changes first, consumers after/)
      expect(template).toMatch(/A MUST appear before B/)
    })
  })

  describe('commit message style block', () => {
    it('requires imperative subjects under 72 chars', () => {
      expect(template).toMatch(/imperative mood/)
      expect(template).toMatch(/under 72 chars/)
    })

    it('discourages "this commit" / "this change" wording', () => {
      expect(template).toMatch(/Avoid phrases like "this commit"/)
    })
  })

  describe('placeholders', () => {
    it('threads in commit_message_rules, commitlint_rules_context, branch_name_context', () => {
      expect(template).toMatch(/\{commit_message_rules\}/)
      expect(template).toMatch(/\{commitlint_rules_context\}/)
      expect(template).toMatch(/\{branch_name_context\}/)
    })

    it('threads in the file + hunk + summary + feedback context', () => {
      expect(template).toMatch(/\{file_inventory\}/)
      expect(template).toMatch(/\{hunk_inventory\}/)
      expect(template).toMatch(/\{summary\}/)
      expect(template).toMatch(/\{previous_attempt_feedback\}/)
    })
  })
})
