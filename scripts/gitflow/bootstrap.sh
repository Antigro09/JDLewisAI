#!/usr/bin/env bash
#
# bootstrap.sh — one-time (idempotent) GitFlow bootstrap for this repository.
#
# Run by a repository admin after the GitFlow setup PR has merged into main.
# Safe to re-run: existing branches are left alone and rulesets are updated
# in place rather than duplicated.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RULESET_DIR="${SCRIPT_DIR}/rulesets"

usage() {
  cat <<'EOF'
Usage: scripts/gitflow/bootstrap.sh [options]

One-time (idempotent) GitFlow bootstrap. Performs, in order:

  1. Verifies the origin remote and that origin/main exists.
  2. Creates the develop branch on origin from origin/main (skipped with a
     note if develop already exists).
  3. With --set-default, makes develop the GitHub default branch.
  4. Configures repository merge settings: merge commits and squash merges
     enabled, rebase merges disabled, squash commit subject taken from the
     PR title (so the Conventional Commits check on titles carries through
     to develop history), merged head branches auto-deleted.
  5. Applies every repository ruleset JSON in scripts/gitflow/rulesets/
     (created when missing, updated in place when a ruleset with the same
     name already exists). Skipped with --skip-rulesets.

Options:
  --set-default    Make develop the GitHub default branch (recommended, so
                   new PRs and clones target develop by default).
  --skip-rulesets  Do not create or update repository rulesets.
  --dry-run        Print every mutation instead of performing it. Read-only
                   calls (fetch, listing rulesets) still run.
  -h, --help       Show this help and exit.

Requirements:
  - git, with an "origin" remote pointing at the GitHub repository
  - gh CLI, authenticated (gh auth login) as a user with ADMIN rights on
    the repository (branch creation and rulesets need admin)

Examples:
  scripts/gitflow/bootstrap.sh --dry-run
  scripts/gitflow/bootstrap.sh --set-default
EOF
}

SET_DEFAULT=0
SKIP_RULESETS=0
DRY_RUN=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --set-default)   SET_DEFAULT=1 ;;
    --skip-rulesets) SKIP_RULESETS=1 ;;
    --dry-run)       DRY_RUN=1 ;;
    -h|--help)       usage; exit 0 ;;
    *)
      echo "error: unknown option: $1" >&2
      echo "Run with --help for usage." >&2
      exit 2
      ;;
  esac
  shift
done

# Run a mutating command, or print it under --dry-run.
run() {
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "[dry-run] $*"
  else
    "$@"
  fi
}

# ---------------------------------------------------------------- preflight

command -v git >/dev/null 2>&1 || {
  echo "error: git is not installed or not on PATH" >&2
  exit 1
}
command -v gh >/dev/null 2>&1 || {
  echo "error: gh CLI is not installed (see https://cli.github.com)" >&2
  exit 1
}

if ! git rev-parse --show-toplevel >/dev/null 2>&1; then
  echo "error: not inside a git repository; run from a clone of the repo" >&2
  exit 1
fi
cd "$(git rev-parse --show-toplevel)"

if ! git remote get-url origin >/dev/null 2>&1; then
  echo "error: no 'origin' remote configured; add one pointing at GitHub first" >&2
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "error: gh CLI is not authenticated; run 'gh auth login' as a repo admin" >&2
  exit 1
fi

# Derive OWNER/REPO, preferring gh (resolves the repo GitHub actually sees),
# falling back to parsing the origin remote URL.
NAME_WITH_OWNER="$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null || true)"
if [ -z "${NAME_WITH_OWNER}" ]; then
  ORIGIN_URL="$(git remote get-url origin)"
  NAME_WITH_OWNER="$(printf '%s\n' "${ORIGIN_URL}" \
    | sed -E -e 's#\.git$##' -e 's#^(git@|ssh://git@|https://|http://)##' -e 's#^[^/:]+[:/]##')"
fi
case "${NAME_WITH_OWNER}" in
  */*) : ;;
  *)
    echo "error: could not determine owner/repo from gh or the origin remote URL" >&2
    exit 1
    ;;
esac
OWNER="${NAME_WITH_OWNER%%/*}"
REPO="${NAME_WITH_OWNER##*/}"
echo "Repository: ${OWNER}/${REPO}"

# ------------------------------------------------------------ develop branch

echo "Fetching origin..."
git fetch --prune origin

if ! git rev-parse --verify --quiet refs/remotes/origin/main >/dev/null; then
  echo "error: origin/main does not exist; GitFlow bootstrap requires a main branch on origin" >&2
  exit 1
fi

DEVELOP_STATE=""
if git rev-parse --verify --quiet refs/remotes/origin/develop >/dev/null; then
  echo "develop already exists on origin; leaving it untouched."
  DEVELOP_STATE="already existed"
else
  echo "Creating develop on origin from origin/main..."
  run git push origin origin/main:refs/heads/develop
  if [ "$DRY_RUN" -eq 1 ]; then
    DEVELOP_STATE="would be created from origin/main (dry-run)"
  else
    DEVELOP_STATE="created from origin/main"
  fi
fi

# ------------------------------------------------------------ default branch

DEFAULT_STATE="unchanged (run with --set-default to change it)"
if [ "$SET_DEFAULT" -eq 1 ]; then
  echo "Setting the GitHub default branch to develop..."
  run gh api --method PATCH "repos/${OWNER}/${REPO}" -f default_branch=develop --silent
  if [ "$DRY_RUN" -eq 1 ]; then
    DEFAULT_STATE="would be set to develop (dry-run)"
  else
    DEFAULT_STATE="set to develop"
  fi
fi

# ------------------------------------------------------- repo merge settings

# The rulesets below can only offer merge methods the repository itself has
# enabled, and squash_merge_commit_title=PR_TITLE is what makes the validated
# Conventional Commit PR title become the squash commit subject even for
# single-commit PRs (GitHub's default uses the raw commit message there).
echo "Configuring repository merge settings..."
run gh api --method PATCH "repos/${OWNER}/${REPO}" \
  -F allow_merge_commit=true \
  -F allow_squash_merge=true \
  -F allow_rebase_merge=false \
  -F delete_branch_on_merge=true \
  -f squash_merge_commit_title=PR_TITLE \
  -f squash_merge_commit_message=PR_BODY \
  --silent
if [ "$DRY_RUN" -eq 1 ]; then
  MERGE_SETTINGS_STATE="would be configured (dry-run)"
else
  MERGE_SETTINGS_STATE="configured (merge+squash on, rebase off, squash title = PR title, auto-delete merged branches)"
fi

# ----------------------------------------------------------------- rulesets

RULESETS_STATE="skipped (--skip-rulesets)"
if [ "$SKIP_RULESETS" -eq 0 ]; then
  if [ ! -d "${RULESET_DIR}" ]; then
    echo "error: ruleset directory not found: ${RULESET_DIR}" >&2
    exit 1
  fi

  echo "Listing existing repository rulesets..."
  if ! EXISTING_RULESETS="$(gh api "repos/${OWNER}/${REPO}/rulesets" --paginate \
    --jq '.[] | "\(.id)\t\(.name)"')"; then
    echo "error: could not list existing rulesets (admin rights? network?);" >&2
    echo "       refusing to continue — applying blindly could create duplicates" >&2
    exit 1
  fi

  APPLIED=0
  FOUND_ANY=0
  for RULESET_FILE in "${RULESET_DIR}"/*.json; do
    [ -e "${RULESET_FILE}" ] || continue
    FOUND_ANY=1

    # The ruleset name is the first "name" key in the file (top-level by
    # construction in this repo's ruleset JSONs).
    RULESET_NAME="$(sed -n 's/.*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "${RULESET_FILE}" | head -n 1)"
    if [ -z "${RULESET_NAME}" ]; then
      echo "error: could not read a \"name\" from ${RULESET_FILE}" >&2
      exit 1
    fi

    RULESET_ID="$(printf '%s\n' "${EXISTING_RULESETS}" \
      | awk -F '\t' -v name="${RULESET_NAME}" '$2 == name { print $1; exit }')"

    if [ -n "${RULESET_ID}" ]; then
      echo "Updating ruleset '${RULESET_NAME}' (id ${RULESET_ID}) from ${RULESET_FILE##*/}..."
      run gh api --method PUT "repos/${OWNER}/${REPO}/rulesets/${RULESET_ID}" \
        --input "${RULESET_FILE}" --silent
    else
      echo "Creating ruleset '${RULESET_NAME}' from ${RULESET_FILE##*/}..."
      run gh api --method POST "repos/${OWNER}/${REPO}/rulesets" \
        --input "${RULESET_FILE}" --silent
    fi
    APPLIED=$((APPLIED + 1))
  done

  if [ "${FOUND_ANY}" -eq 0 ]; then
    echo "error: no ruleset JSON files found in ${RULESET_DIR}" >&2
    exit 1
  fi

  if [ "$DRY_RUN" -eq 1 ]; then
    RULESETS_STATE="${APPLIED} ruleset(s) would be applied (dry-run)"
  else
    RULESETS_STATE="${APPLIED} ruleset(s) applied"
  fi
fi

# ------------------------------------------------------------------ summary

echo
echo "== GitFlow bootstrap summary =="
echo "  repository:     ${OWNER}/${REPO}"
echo "  develop branch: ${DEVELOP_STATE}"
echo "  default branch: ${DEFAULT_STATE}"
echo "  merge settings: ${MERGE_SETTINGS_STATE}"
echo "  rulesets:       ${RULESETS_STATE}"
echo
echo "Next steps:"
echo "  1. Verify the rulesets under GitHub: Settings -> Rules -> Rulesets."
echo "  2. Set the Vercel production branch to 'main' (Vercel: Project Settings"
echo "     -> Git -> Production Branch), so only merges to main deploy to prod."
echo "  3. Optional: add a BACKMERGE_TOKEN repo secret (a PAT with repo access)"
echo "     so backmerge PRs opened by automation trigger the required CI checks."
echo "  4. Re-running this script at any time is safe (idempotent)."
