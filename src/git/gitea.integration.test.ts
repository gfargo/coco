import { makeGiteaRunner } from './giteaCli'
import { __test as listInternals } from './giteaListData'

/**
 * Live Gitea/Forgejo/Codeberg integration test. Exercises the REAL Gitea REST
 * API v1 against a REAL repository to validate end-to-end: auth works, the
 * endpoints are correct, and coco's parsers handle real Gitea/Forgejo JSON.
 *
 * GATED — skips unless you opt in, so the default suite (and CI without Gitea
 * credentials) stays green:
 *
 *   COCO_GITEA_IT=1 \
 *   COCO_GITEA_TEST_PROJECT="owner/repo-slug" \
 *   GITEA_HOST="codeberg.org" \
 *   GITEA_TOKEN="<your-token>" \
 *   npm run test:integration -- gitea.integration
 *
 * Requirements: a Gitea/Forgejo/Codeberg access token with at least read
 * access to the project. Read-only: this test never mutates anything.
 */

const RUN = process.env.COCO_GITEA_IT === '1'
const PROJECT = process.env.COCO_GITEA_TEST_PROJECT
const HOST = process.env.GITEA_HOST
const describeLive = RUN && PROJECT && HOST ? describe : describe.skip

describeLive('Gitea/Forgejo live integration (read-only)', () => {
  const path = PROJECT as string
  const runner = makeGiteaRunner(HOST as string)

  it('authenticates and lists pull requests, mapping to the shared shape', async () => {
    const out = await runner(`repos/${path}/pulls?state=open&limit=3`)
    const data = JSON.parse(out)
    expect(Array.isArray(data)).toBe(true)

    for (const raw of data) {
      const pr = listInternals.mapPullRequestItem(raw)
      expect(typeof pr.number).toBe('number')
      expect(['OPEN', 'CLOSED', 'MERGED']).toContain(pr.state)
      expect(typeof pr.isDraft).toBe('boolean')
    }
  }, 30_000)

  it('lists issues and maps them to the shared shape', async () => {
    const out = await runner(`repos/${path}/issues?state=all&limit=3`)
    const data = JSON.parse(out)
    expect(Array.isArray(data)).toBe(true)

    for (const raw of data.filter((entry: Record<string, unknown>) => !listInternals.isPullRequestEntry(entry))) {
      const issue = listInternals.mapIssueItem(raw)
      expect(typeof issue.number).toBe('number')
      expect(['OPEN', 'CLOSED']).toContain(issue.state)
    }
  }, 30_000)

  it('resolves the authenticated user via /user', async () => {
    const out = await runner('user')
    const user = JSON.parse(out) as { login?: string }
    expect(typeof user.login).toBe('string')
  }, 30_000)
})
