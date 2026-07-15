#!/usr/bin/env bash
#
# start-release.sh — cut a release/x.y.z branch from origin/develop, bump the
# root package.json version, push, and open the PR into main.

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/gitflow/start-release.sh <version>

Starts a GitFlow release:

  1. Verifies a clean working tree and that origin/develop exists.
  2. Verifies tag v<version> does not already exist (locally or on origin).
  3. Creates release/<version> from origin/develop.
  4. Bumps the ROOT package.json to <version> (npm version, no git tag).
  5. Commits "chore(release): start release <version>" and pushes the branch.
  6. Opens a PR into main (via gh, or prints the URL to open it manually).

Arguments:
  <version>   Strict semver x.y.z, e.g. 1.4.0 (no leading "v", no pre-release
              suffix — release branches are named release/x.y.z).

Notes:
  - Stabilize the release by landing bugfix/* PRs based on the release branch.
  - Merge the release PR into main with a MERGE COMMIT (not squash); the
    release-tag workflow then tags v<version>, creates the GitHub Release,
    and the backmerge workflow opens the PR back into develop.

Example:
  scripts/gitflow/start-release.sh 1.4.0
EOF
}

case "${1:-}" in
  -h|--help) usage; exit 0 ;;
esac

if [ "$#" -ne 1 ]; then
  echo "error: expected exactly one argument: <version>" >&2
  echo "Run with --help for usage." >&2
  exit 2
fi

VERSION="$1"
if ! printf '%s' "${VERSION}" | grep -Eq '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'; then
  echo "error: '${VERSION}' is not a strict semver version (expected x.y.z, e.g. 1.4.0)" >&2
  exit 1
fi

BRANCH="release/${VERSION}"
TAG="v${VERSION}"

command -v git >/dev/null 2>&1 || { echo "error: git is not installed or not on PATH" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "error: node is not installed or not on PATH" >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "error: npm is not installed or not on PATH" >&2; exit 1; }

if ! git rev-parse --show-toplevel >/dev/null 2>&1; then
  echo "error: not inside a git repository; run from a clone of the repo" >&2
  exit 1
fi
cd "$(git rev-parse --show-toplevel)"

if ! git remote get-url origin >/dev/null 2>&1; then
  echo "error: no 'origin' remote configured" >&2
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "error: working tree is not clean; commit or stash your changes first" >&2
  exit 1
fi

echo "Fetching origin..."
git fetch --prune origin

if ! git rev-parse --verify --quiet refs/remotes/origin/develop >/dev/null; then
  echo "error: origin/develop does not exist; run scripts/gitflow/bootstrap.sh first" >&2
  exit 1
fi

if git rev-parse --verify --quiet "refs/tags/${TAG}" >/dev/null; then
  echo "error: tag ${TAG} already exists locally; version ${VERSION} has already been released" >&2
  exit 1
fi
if [ -n "$(git ls-remote --tags origin "refs/tags/${TAG}")" ]; then
  echo "error: tag ${TAG} already exists on origin; version ${VERSION} has already been released" >&2
  exit 1
fi

if git rev-parse --verify --quiet "refs/heads/${BRANCH}" >/dev/null; then
  echo "error: local branch ${BRANCH} already exists; check it out to continue that release," >&2
  echo "       or delete it (git branch -D ${BRANCH}) and re-run" >&2
  exit 1
fi
if [ -n "$(git ls-remote --heads origin "refs/heads/${BRANCH}")" ]; then
  echo "error: ${BRANCH} already exists on origin; this release is already started." >&2
  echo "       Check it out (git checkout ${BRANCH}) to continue it instead of re-running this script." >&2
  exit 1
fi

echo "Creating ${BRANCH} from origin/develop..."
git checkout -b "${BRANCH}" origin/develop

CURRENT_VERSION="$(node -p "require('./package.json').version")"
if [ "${CURRENT_VERSION}" = "${VERSION}" ]; then
  echo "note: root package.json is already at ${VERSION}; skipping version bump."
else
  echo "Bumping root package.json ${CURRENT_VERSION} -> ${VERSION}..."
  npm version "${VERSION}" --no-git-tag-version
  git add package.json
  if [ -f package-lock.json ]; then
    git add package-lock.json
  fi
  git commit -m "chore(release): start release ${VERSION}"
fi

echo "Pushing ${BRANCH} to origin..."
git push -u origin "${BRANCH}"

PR_BODY="## Release ${VERSION}

Cut from \`develop\`. Only stabilization fixes from here on.

### Checklist
- [ ] Stabilize: land fixes as \`bugfix/*\` PRs targeting \`${BRANCH}\` (not develop)
- [ ] CI is green on this branch
- [ ] Merge this PR with a **merge commit** (not squash) to preserve history

### After merge (automated)
- Tag \`${TAG}\` is created at the merge commit and a GitHub Release is published.
- A \`backmerge/main\` PR into \`develop\` is opened automatically — merge it promptly."

if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  echo "Opening the release PR into main..."
  gh pr create \
    --base main \
    --head "${BRANCH}" \
    --title "chore(release): ${VERSION}" \
    --body "${PR_BODY}"
else
  ORIGIN_URL="$(git remote get-url origin)"
  NAME_WITH_OWNER="$(printf '%s\n' "${ORIGIN_URL}" \
    | sed -E -e 's#\.git$##' -e 's#^(git@|ssh://git@|https://|http://)##' -e 's#^[^/:]+[:/]##')"
  echo "note: gh CLI is unavailable or unauthenticated; open the PR manually:"
  echo "  https://github.com/${NAME_WITH_OWNER}/compare/main...${BRANCH}?expand=1"
  echo "  Title: chore(release): ${VERSION}"
  echo "  Merge with a MERGE COMMIT (not squash)."
fi

echo "Done. Release ${VERSION} started on ${BRANCH}."
