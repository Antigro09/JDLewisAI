#!/usr/bin/env bash
#
# start-hotfix.sh — cut a hotfix/x.y.z branch from origin/main for a
# production emergency, bump the root package.json version, push, and open
# the PR into main.

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/gitflow/start-hotfix.sh <version>

Starts a GitFlow hotfix (production emergency fix):

  1. Verifies a clean working tree and that origin/main exists.
  2. Verifies tag v<version> does not already exist (locally or on origin).
  3. Creates hotfix/<version> from origin/main.
  4. Bumps the ROOT package.json to <version> (npm version, no git tag).
  5. Commits "fix: start hotfix <version>" and pushes the branch.
  6. Opens a PR into main (via gh, or prints the URL to open it manually).

Arguments:
  <version>   Strict semver x.y.z, e.g. 1.4.1 (no leading "v", no pre-release
              suffix — hotfix branches are named hotfix/x.y.z). Usually the
              current production version with the patch number incremented.

Notes:
  - Commit the actual fix onto the hotfix branch after running this script.
  - Merge the hotfix PR into main with a MERGE COMMIT (not squash); the
    release-tag workflow then tags v<version>, creates the GitHub Release,
    and the backmerge workflow opens the PR back into develop.

Example:
  scripts/gitflow/start-hotfix.sh 1.4.1
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
  echo "error: '${VERSION}' is not a strict semver version (expected x.y.z, e.g. 1.4.1)" >&2
  exit 1
fi

BRANCH="hotfix/${VERSION}"
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

if ! git rev-parse --verify --quiet refs/remotes/origin/main >/dev/null; then
  echo "error: origin/main does not exist; hotfixes branch from main" >&2
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
  echo "error: local branch ${BRANCH} already exists; check it out to continue that hotfix," >&2
  echo "       or delete it (git branch -D ${BRANCH}) and re-run" >&2
  exit 1
fi
if [ -n "$(git ls-remote --heads origin "refs/heads/${BRANCH}")" ]; then
  echo "error: ${BRANCH} already exists on origin; this hotfix is already started." >&2
  echo "       Check it out (git checkout ${BRANCH}) to continue it instead of re-running this script." >&2
  exit 1
fi

echo "Creating ${BRANCH} from origin/main..."
git checkout -b "${BRANCH}" origin/main

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
  git commit -m "fix: start hotfix ${VERSION}"
fi

echo "Pushing ${BRANCH} to origin..."
git push -u origin "${BRANCH}"

PR_BODY="## Hotfix ${VERSION}

Production emergency fix, cut from \`main\`. Expedited review requested —
keep the diff minimal and focused on the fix.

### Checklist
- [ ] Commit the fix onto \`${BRANCH}\` (direct pushes are allowed here)
- [ ] CI is green on this branch
- [ ] Merge this PR with a **merge commit** (not squash) to preserve history

### After merge (automated)
- Tag \`${TAG}\` is created at the merge commit and a GitHub Release is published.
- A \`backmerge/main\` PR into \`develop\` is opened automatically — merge it promptly
  so the fix also lands on develop."

if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  echo "Opening the hotfix PR into main..."
  gh pr create \
    --base main \
    --head "${BRANCH}" \
    --title "fix: hotfix ${VERSION}" \
    --body "${PR_BODY}"
else
  ORIGIN_URL="$(git remote get-url origin)"
  NAME_WITH_OWNER="$(printf '%s\n' "${ORIGIN_URL}" \
    | sed -E -e 's#\.git$##' -e 's#^(git@|ssh://git@|https://|http://)##' -e 's#^[^/:]+[:/]##')"
  echo "note: gh CLI is unavailable or unauthenticated; open the PR manually:"
  echo "  https://github.com/${NAME_WITH_OWNER}/compare/main...${BRANCH}?expand=1"
  echo "  Title: fix: hotfix ${VERSION}"
  echo "  Merge with a MERGE COMMIT (not squash)."
fi

echo "Done. Hotfix ${VERSION} started on ${BRANCH}."
