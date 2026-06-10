# Testing coco against a live GitLab

coco's GitLab support shells out to the [`glab`](https://gitlab.com/gitlab-org/cli)
CLI and the GitLab REST API. The unit tests cover field mapping and CLI-flag
contracts (including a live `glab --help` compatibility check), but validating
the real end-to-end behavior needs an actual GitLab instance. There are two
ways to get one.

## Prerequisites

- `glab` installed: `brew install glab` (macOS) or see the
  [glab install docs](https://gitlab.com/gitlab-org/cli#installation).
- coco built from this branch.

---

## Option A — gitlab.com (fastest)

1. Create a free account at https://gitlab.com and a throwaway project (e.g.
   `your-user/coco-sandbox`). Add a merge request and an issue or two so there
   is something to list.
2. Authenticate glab:
   ```bash
   glab auth login            # choose gitlab.com, paste a PAT with `api` scope
   glab auth status           # should report gitlab.com: logged in
   ```
3. Run the gated live integration test (read-only):
   ```bash
   COCO_GITLAB_IT=1 \
   COCO_GITLAB_TEST_PROJECT="your-user/coco-sandbox" \
   npm run test:integration -- gitlab.integration
   ```
4. Drive coco against the sandbox repo directly (clone it first, then `cd` in):
   ```bash
   coco prs --json
   coco issues
   coco pr create --dry-run        # generates an MR title/body from the diff
   coco ui                          # gP / gi triage views, inspectors, actions
   ```

Pros: real GitLab, zero infra. Cons: a public-ish account; use a throwaway
project for destructive checks.

---

## Option B — self-hosted GitLab CE in Docker (isolated)

Good for destructive testing and for exercising the self-hosted / Enterprise
paths.

1. Boot it:
   ```bash
   docker compose -f docker-compose.gitlab.yml up -d
   echo "127.0.0.1 gitlab.local" | sudo tee -a /etc/hosts
   ```
   First boot takes a few minutes and ~4 GB RAM. Wait for `healthy`:
   ```bash
   docker compose -f docker-compose.gitlab.yml ps
   ```
2. Get the root password and log in at http://gitlab.local:8929:
   ```bash
   docker compose -f docker-compose.gitlab.yml exec gitlab \
     cat /etc/gitlab/initial_root_password
   ```
3. Create a project + a Personal Access Token (`api` scope), then:
   ```bash
   glab auth login --hostname gitlab.local:8929 --token <PAT>
   ```
4. Run the gated test against it:
   ```bash
   COCO_GITLAB_IT=1 \
   COCO_GITLAB_TEST_PROJECT="root/your-project" \
   npm run test:integration -- gitlab.integration
   ```

`gitlab.local` contains "gitlab", so coco auto-detects the forge. To exercise
the **vanity-host** path (a host with neither `gitlab` nor `github` in its
name), use a hostname like `git.local` and add to your coco config:

```json
{ "forgeHosts": { "git.local": "gitlab" } }
```

Tear down (and wipe data):
```bash
docker compose -f docker-compose.gitlab.yml down -v
```

---

## What the gated test covers

`src/git/gitlab.integration.test.ts` (skipped unless `COCO_GITLAB_IT=1` and
`COCO_GITLAB_TEST_PROJECT` are set) is **read-only**. It validates against the
real instance that:

- `glab` is authenticated and the `glab api` endpoints coco uses are correct.
- coco's MR / issue / project parsers handle real GitLab JSON.

## Manual write-path checklist

The mutating actions are intentionally not automated (they change real data).
Validate them by hand against a throwaway project, in `coco ui`:

| Surface | Action | Expected |
|---|---|---|
| `gP` (PR triage) | `C` comment | note appears on the MR |
| `gP` | `L` label / `A` assign | label added / you are added as assignee (not replaced) |
| `gP` | `M` merge / `X` close / `/` approve | MR merges / closes / is approved |
| `gP` | `R` request changes | a `Requested changes: …` note is posted |
| `gi` (issue triage) | `C` / `L` / `A` / `X` / `/` | comment / label / assign / close / reopen |
| `coco pr create` | create | MR opens (branch is pushed via `--push`) |
| `g p` (single PR) | view | the current branch's MR renders (body, status) |

If any flag breaks in a future `glab` release, the
`glabCompat.test.ts` flag-compatibility test fails first (when `glab` is
installed) — fix the arg builders, then re-run this checklist.
