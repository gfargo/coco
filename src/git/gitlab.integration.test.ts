import { defaultGlabRunner } from './glabCli'
import { __test as listInternals } from './gitlabListData'

/**
 * Live GitLab integration test. Exercises the REAL `glab` binary against a REAL
 * GitLab project to validate end-to-end: auth works, the `glab api` endpoints
 * are correct, and coco's parsers handle real GitLab JSON. This is the piece
 * that fixture tests can't cover.
 *
 * GATED — skips unless you opt in, so the default suite (and CI without GitLab
 * credentials) stays green:
 *
 *   COCO_GITLAB_IT=1 \
 *   COCO_GITLAB_TEST_PROJECT="group/project" \
 *   npm run test:integration -- gitlab.integration
 *
 * Requirements: `glab` installed and authenticated (`glab auth login`, or
 * `--hostname <your-host>` for self-hosted). The project must be one your token
 * can read. Read-only: this test never mutates anything. See
 * docs/gitlab-integration-testing.md for the full setup (gitlab.com or a local
 * Docker GitLab) and the manual write-path checklist.
 */

const RUN = process.env.COCO_GITLAB_IT === '1'
const PROJECT = process.env.COCO_GITLAB_TEST_PROJECT
const describeLive = RUN && PROJECT ? describe : describe.skip

describeLive('GitLab live integration (read-only)', () => {
  const enc = encodeURIComponent(PROJECT as string)

  it('authenticates and lists merge requests via glab api, mapping to the shared shape', async () => {
    const out = await defaultGlabRunner(['api', `projects/${enc}/merge_requests?state=all&per_page=3`])
    expect(Array.isArray(JSON.parse(out))).toBe(true)

    const parsed = listInternals.parseMergeRequests(out)
    for (const mr of parsed) {
      expect(typeof mr.number).toBe('number')
      expect(['OPEN', 'CLOSED', 'MERGED', 'LOCKED']).toContain(mr.state)
      expect(typeof mr.isDraft).toBe('boolean')
    }
  }, 30_000)

  it('lists issues via glab api and maps them', async () => {
    const out = await defaultGlabRunner(['api', `projects/${enc}/issues?per_page=3`])
    expect(Array.isArray(JSON.parse(out))).toBe(true)

    const parsed = listInternals.parseIssues(out)
    for (const issue of parsed) {
      expect(typeof issue.number).toBe('number')
      expect(['OPEN', 'CLOSED']).toContain(issue.state)
    }
  }, 30_000)

  it('resolves the project (default branch) the way getProviderOverview does', async () => {
    const out = await defaultGlabRunner(['api', `projects/${enc}`])
    const project = JSON.parse(out) as { default_branch?: string }
    expect(typeof project.default_branch).toBe('string')
  }, 30_000)
})
