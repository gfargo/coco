import { defaultBitbucketRunner } from './bitbucketCli'
import { __test as listInternals } from './bitbucketListData'

/**
 * Live Bitbucket integration test. Exercises the REAL Bitbucket REST API v2
 * against a REAL Bitbucket repository to validate end-to-end: auth works, the
 * endpoints are correct, and coco's parsers handle real Bitbucket JSON.
 *
 * GATED — skips unless you opt in, so the default suite (and CI without
 * Bitbucket credentials) stays green:
 *
 *   COCO_BITBUCKET_IT=1 \
 *   COCO_BITBUCKET_TEST_PROJECT="workspace/repo-slug" \
 *   BITBUCKET_ACCESS_TOKEN="<your-token>" \
 *   npm run test:integration -- bitbucket.integration
 *
 * Requirements: A Bitbucket Cloud app password or access token with at least
 * repository:read scope. The project must be one your token can read.
 * Read-only: this test never mutates anything.
 */

const RUN = process.env.COCO_BITBUCKET_IT === '1'
const PROJECT = process.env.COCO_BITBUCKET_TEST_PROJECT
const describeLive = RUN && PROJECT ? describe : describe.skip

describeLive('Bitbucket live integration (read-only)', () => {
  const path = PROJECT as string

  it('authenticates and lists pull requests, mapping to the shared shape', async () => {
    const out = await defaultBitbucketRunner(
      `repositories/${path}/pullrequests?state=OPEN&pagelen=3`
    )
    const data = JSON.parse(out)
    expect(Array.isArray(data.values)).toBe(true)

    const parsed = listInternals.parsePullRequests(out)
    for (const pr of parsed) {
      expect(typeof pr.number).toBe('number')
      expect(['OPEN', 'CLOSED', 'MERGED']).toContain(pr.state)
      expect(typeof pr.isDraft).toBe('boolean')
    }
  }, 30_000)

  it('lists issues and maps them to the shared shape', async () => {
    const out = await defaultBitbucketRunner(
      `repositories/${path}/issues?pagelen=3`
    )
    const data = JSON.parse(out)
    expect(Array.isArray(data.values)).toBe(true)

    const parsed = listInternals.parseIssues(out)
    for (const issue of parsed) {
      expect(typeof issue.number).toBe('number')
      expect(['OPEN', 'CLOSED']).toContain(issue.state)
    }
  }, 30_000)

  it('resolves the authenticated user via /user', async () => {
    const out = await defaultBitbucketRunner('user')
    const user = JSON.parse(out) as { nickname?: string }
    expect(typeof user.nickname).toBe('string')
  }, 30_000)
})
