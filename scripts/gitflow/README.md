# GitFlow operations

Operator guide for the GitFlow scripts and branch-protection rulesets in this
directory. For the branching model itself (what each branch is for, PR
targeting rules, naming), see `docs/gitflow/`.

## Contents

| Path | Purpose |
| --- | --- |
| `bootstrap.sh` | One-time (idempotent) setup: creates `develop`, optionally sets it as the default branch, configures repo merge settings, applies the rulesets. |
| `start-release.sh` | Cuts `release/x.y.z` from `develop`, bumps the root version, opens the PR into `main`. |
| `start-hotfix.sh` | Cuts `hotfix/x.y.z` from `main` for production emergencies, bumps the root version, opens the PR into `main`. |
| `rulesets/main.json` | Repository ruleset for `main`. |
| `rulesets/develop.json` | Repository ruleset for `develop`. |
| `rulesets/release-hotfix.json` | Repository ruleset for `release/**` and `hotfix/**`. |

## Prerequisites

- `git` with an `origin` remote pointing at the GitHub repository.
- The [`gh` CLI](https://cli.github.com), authenticated as a user with
  **admin** rights on the repository:

  ```sh
  gh auth login
  gh auth status   # verify
  ```

  Admin rights are required because bootstrap creates a branch on origin,
  can change the default branch, and manages repository rulesets.
- Node 22 + npm (for the release/hotfix scripts, which run `npm version`).

## One-time adoption (in this order)

1. **Merge the GitFlow setup PR** into `main`. Nothing is enforced yet: the
   `branch-policy` check passes with a notice while `develop` does not exist
   (the phase-in guard), so the setup PR itself is not blocked.
2. **Run bootstrap** from an up-to-date clone:

   ```sh
   ./scripts/gitflow/bootstrap.sh --set-default
   ```

   This creates `develop` from `origin/main`, makes it the GitHub default
   branch (so new PRs and clones target `develop`), configures the repo
   merge settings (merge commits + squash enabled, rebase merges disabled,
   **squash commit subject = PR title** so the Conventional Commits check
   carries through to `develop` history, merged head branches auto-deleted),
   and applies the three rulesets. Add `--dry-run` first if you want to
   preview every mutation. Once `develop` exists on origin, the
   `branch-policy` check arms itself and starts enforcing PR base/head
   pairing.
3. **Verify the rulesets** on GitHub: *Settings → Rules → Rulesets*. You
   should see "GitFlow: main", "GitFlow: develop", and "GitFlow: release and
   hotfix branches", all **Active**.
4. **Point Vercel at `main`**: *Vercel → Project Settings → Git → Production
   Branch* → `main`. Every merge to `main` is a production deploy; every PR
   still gets a preview deployment.
5. **Optional: add a `BACKMERGE_TOKEN` secret** (*Settings → Secrets and
   variables → Actions*) containing a fine-grained PAT with contents +
   pull-request write access. Why: PRs opened with the default
   `GITHUB_TOKEN` do **not** trigger other workflows, so the automated
   `backmerge/main → develop` PR would sit with no CI checks and could not
   satisfy the required status checks. A PAT makes those PRs run CI like any
   human-opened PR. Without it, someone must manually re-run/trigger checks
   on backmerge PRs (e.g. close and reopen, or push an empty commit).

## Script reference

### `bootstrap.sh`

```sh
./scripts/gitflow/bootstrap.sh [--set-default] [--skip-rulesets] [--dry-run]
```

| Flag | Effect |
| --- | --- |
| `--set-default` | Make `develop` the GitHub default branch. |
| `--skip-rulesets` | Skip creating/updating repository rulesets. |
| `--dry-run` | Print every mutation instead of performing it. |
| `-h`, `--help` | Usage. |

Idempotent: an existing `develop` is left untouched, and rulesets are matched
by name — existing ones are updated in place (PUT), missing ones are created
(POST). Re-run it whenever a `rulesets/*.json` file changes to sync GitHub
with the files in this repo.

### `start-release.sh`

```sh
./scripts/gitflow/start-release.sh 1.4.0
```

Requires a clean working tree. Creates `release/1.4.0` from
`origin/develop`, bumps the **root** `package.json` to `1.4.0`
(`npm version --no-git-tag-version`; the `electron/` and `mobile/` versions
are independent and untouched), commits
`chore(release): start release 1.4.0`, pushes, and opens a PR into `main`
titled `chore(release): 1.4.0`.

Then: stabilize with `bugfix/*` PRs targeting the release branch (direct
pushes are also allowed there), and merge the release PR with a **merge
commit**. Automation tags `v1.4.0`, publishes the GitHub Release, and opens
the backmerge PR into `develop`.

### `start-hotfix.sh`

```sh
./scripts/gitflow/start-hotfix.sh 1.4.1
```

Same flow but branches from `origin/main`, commits
`fix: start hotfix 1.4.1`, and opens a PR titled `fix: hotfix 1.4.1`.
Commit the actual fix onto the hotfix branch after running the script. Merge
with a merge commit; tagging and backmerge are automated, same as releases.

## Ruleset reference

Rulesets are GitHub **repository rulesets** (not legacy branch protection),
stored as strict JSON (no comments) and applied by `bootstrap.sh`.

| Ruleset | Applies to | Enforces |
| --- | --- | --- |
| `GitFlow: main` | `refs/heads/main` | No deletion, no force-push; PRs only, **1 approval**, stale reviews dismissed on push, code-owner review, review threads resolved; merge method: **merge commit only** (release/hotfix PRs must not be squashed — the tag and backmerge flow assumes merge commits); required checks `build`, `takeoff-tests`, `pr-title`, `branch-policy` — **strict** (branch must be up to date with `main` before merging). |
| `GitFlow: develop` | `refs/heads/develop` | No deletion, no force-push; PRs only, **0 approvals** (solo-maintainer setting), stale reviews dismissed, review threads resolved; merge commit or squash; same 4 required checks, non-strict (no up-to-date requirement, to keep merge trains cheap). |
| `GitFlow: release and hotfix branches` | `refs/heads/release/**`, `refs/heads/hotfix/**` | No deletion, no force-push only. Direct pushes are allowed — these are stabilization branches. |

Notes:

- **Admin bypass**: each ruleset lists bypass actor `{"actor_id": 5,
  "actor_type": "RepositoryRole", "bypass_mode": "always"}`. Actor id 5 is
  the built-in **Repository admin** role, so admins (currently the sole
  maintainer) can push through in an emergency. GitHub still surfaces the
  bypass in the UI and audit log. The JSON files carry no comments —
  repository rulesets must be strict JSON — so this file is the
  documentation of record for that magic number.
- **Required check contexts** are GitHub Actions **job ids** (`build`,
  `takeoff-tests`, `pr-title`, `branch-policy`). If you rename a job id in a
  workflow, update all three ruleset JSONs and re-run bootstrap, or merges
  will wait forever on a check that never reports.
- **Code-owner review on `main`** is driven by `.github/CODEOWNERS` (part of
  this setup); edit that file as ownership changes — no ruleset change needed.
- **Merged `release/*` / `hotfix/*` branches**: the deletion rule applies to
  these branches even after merging, so GitHub's auto-delete skips them and
  non-admins cannot delete them. Deleting a merged release branch is an admin
  (bypass) action — or keep them as a permanent record, which is the intent.
- **When the team grows**: raise `required_approving_review_count` in
  `rulesets/develop.json` from `0` to `1` (and consider
  `require_last_push_approval: true` on `main`), then re-run
  `./scripts/gitflow/bootstrap.sh` to apply. Keep the JSON files as the
  source of truth rather than editing rulesets in the GitHub UI.

## Troubleshooting

- **Re-running bootstrap** is always safe. It never deletes anything; it
  only creates what is missing and updates rulesets by name to match the
  JSON files.
- **A ruleset name was changed by hand in the GitHub UI**: bootstrap matches
  rulesets by name, so it will no longer find the renamed one and will
  create a fresh ruleset with the canonical name — leaving the renamed one
  active in parallel (rules stack, so this over-enforces rather than
  under-enforces). Fix: delete the hand-renamed ruleset in *Settings → Rules
  → Rulesets* (or rename it back), then re-run bootstrap.
- **`error: origin/develop does not exist` from start-release.sh**: run
  `./scripts/gitflow/bootstrap.sh` first — releases are cut from `develop`.
- **`gh: Not Found` / 403 during bootstrap**: your `gh` login lacks admin
  rights on the repository, or you are authenticated against the wrong
  account. Check `gh auth status` and `gh repo view`.
- **A release PR is blocked on a check that never runs**: confirm the four
  required contexts exactly match the workflow job ids, and that the
  workflows trigger for the PR (CI runs on every `pull_request`).
- **Backmerge PR shows no checks**: the `BACKMERGE_TOKEN` secret is missing
  or expired — see step 5 of the adoption list.
