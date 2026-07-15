# Contributing to ContractorAI

Thanks for contributing. This guide covers the day-to-day mechanics: how to name branches, how
to write PR titles, and what has to be green before a merge. For the full branching model
(releases, hotfixes, backmerges, protection rules), see
[`docs/gitflow/README.md`](docs/gitflow/README.md); for the release helper scripts, see
[`scripts/gitflow/README.md`](scripts/gitflow/README.md).

## Local setup

Follow the setup instructions in the root [`README.md`](README.md). In short: Node 22,
`npm ci`, and a `.env` with the documented variables. The Takeoff Engine
(`takeoff-engine/`) is a separate Python 3.11 project — see its own
[`README.md`](takeoff-engine/README.md).

## Branches

All work branches are cut from `develop` and PR back into `develop`. Never open a PR into
`main` from a work branch — the `branch-policy` check will fail it (only `release/*` and
`hotfix/*` may target `main`).

```bash
git fetch origin
git switch -c feature/my-change origin/develop
```

Allowed branch prefixes:

| Prefix | Use for |
| --- | --- |
| `feature/` | New functionality |
| `bugfix/` | Bug fixes (also used on release branches during stabilization) |
| `chore/` | Maintenance, deps, tooling, housekeeping |
| `docs/` | Documentation only |
| `refactor/` | Restructuring without behavior change |
| `test/` | Adding or improving tests |
| `perf/` | Performance work |
| `ci/` | CI/CD workflow changes |
| `build/` | Build system, bundling, packaging |
| `experiment/` | Spikes and prototypes (may never merge) |
| `claude/` | AI-session branches (created automatically) |
| `dependabot/` | Automated dependency updates |

Reserved for maintainers and automation: `release/x.y.z`, `hotfix/x.y.z`, `backmerge/*`.
Branches created by GitHub's **Revert** button (`revert-<pr>-<branch>`) are also accepted.

## Conventional Commits

PR titles must follow [Conventional Commits](https://www.conventionalcommits.org/). Because we
squash-merge into `develop`, your PR title *becomes the commit subject* — individual commits on
your branch can say whatever you like.

Format:

```
<type>(<scope>)!: <subject>
```

- `type` is required; `(scope)` is optional and may contain `a-z 0-9 , . / -`; `!` marks a
  breaking change; the subject is required. Keep the whole title under ~100 characters.
- Enforced by the `pr-title` check with this pattern:
  `^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([a-z0-9,./-]+\))?!?: .+`
  (GitHub's auto-generated `Revert "..."` titles are also accepted).

| Type | Meaning |
| --- | --- |
| `feat` | New user-facing functionality |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `style` | Formatting, whitespace — no code meaning change |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `perf` | Performance improvement |
| `test` | Adding or correcting tests |
| `build` | Build system or external dependencies |
| `ci` | CI configuration and workflows |
| `chore` | Everything else that doesn't touch app behavior |
| `revert` | Reverts a previous commit |

Realistic examples:

```
feat(invoices): add progress-billing PDF export
fix(takeoff-engine): handle rotated TIFF pages in scale detection
feat(estimates)!: require a project id when creating an estimate
refactor(auth): move session helpers into lib/auth
docs(gitflow): clarify the hotfix runbook
```

## Pull request process

1. Branch from `develop` using an allowed prefix; push and open a PR **with base `develop`**.
2. Give the PR a Conventional Commit title — the `pr-title` check enforces this.
3. Fill in the PR template checklist (tests, docs, screenshots where relevant).
4. Wait for all four required checks to pass (table below). Every PR also gets a Vercel preview
   deployment for manual verification.
5. Merge with **"Squash and merge"**. PRs into `develop` need no approvals today
   (solo-maintainer default); PRs into `main` — release and hotfix branches only — require 1
   approval with code-owner review and are merged with a **merge commit** instead.
6. Delete your branch after merging.

## Required checks

Every PR must pass these four checks. The names are GitHub Actions job ids — do not rename them.

| Check | Workflow | What it does | Run the equivalent locally |
| --- | --- | --- | --- |
| `build` | `.github/workflows/ci.yml` | Installs deps, audits, typechecks, lints, tests, and builds the Next.js app | `npm ci && npm audit --omit=dev --audit-level=high && npm run typecheck && npm run lint && npm test && npm run build` |
| `takeoff-tests` | `.github/workflows/takeoff-engine-ci.yml` | Lints and tests the Python Takeoff Engine (only runs when `takeoff-engine/**` changes) | In `takeoff-engine/`: `pip install -e ".[dev]"`, then `python -m ruff check app tests` and `python -m pytest tests/ -q` |
| `pr-title` | PR Checks (`.github/workflows/pr-checks.yml`) | Validates the PR title against the Conventional Commits pattern above | Eyeball your title against the pattern before opening the PR |
| `branch-policy` | PR Checks (`.github/workflows/pr-checks.yml`) | Enforces base/head rules: only `release/*` / `hotfix/*` into `main`; allowed prefixes into `develop` | Use an allowed branch prefix and target `develop` |

Quick local pre-flight for a typical web change:

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

## Releases, hotfixes, versioning

Handled by maintainers via `scripts/gitflow/start-release.sh` and
`scripts/gitflow/start-hotfix.sh`; tags (`vX.Y.Z`) and GitHub Releases are created
automatically when a release or hotfix PR merges into `main`. The full runbooks — including
release stabilization rules and how backmerges to `develop` work — live in
[`docs/gitflow/README.md`](docs/gitflow/README.md).
