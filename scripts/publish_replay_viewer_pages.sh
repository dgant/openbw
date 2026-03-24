#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKSPACE_DIR="$(cd "${ROOT_DIR}/.." && pwd)"
WRAPPER_DIR="${WORKSPACE_DIR}/openbw-replay-viewer"
GH_TOKEN="${GH_TOKEN:-}"
REMOTE_REPO="${REMOTE_REPO:-dgant/openbw-replay-viewer}"
COMMIT_MESSAGE="${1:-Deploy replay viewer from openbw}"
REPO_OWNER="${REMOTE_REPO%%/*}"
REPO_NAME="${REMOTE_REPO#*/}"

if [ -z "${GH_TOKEN}" ] && [ -f "${WORKSPACE_DIR}/.env" ]; then
  GH_TOKEN="$(sed -n 's/^GH_TOKEN=//p' "${WORKSPACE_DIR}/.env")"
fi

if [ -z "${GH_TOKEN}" ]; then
  echo "GH_TOKEN is required" >&2
  exit 1
fi

"${ROOT_DIR}/scripts/prepare_github_pages_site.sh"

pushd "${WRAPPER_DIR}" >/dev/null

git add Readme.md .gitignore docs
if ! git diff --cached --quiet; then
  git commit -m "${COMMIT_MESSAGE}"
fi

git push "https://x-access-token:${GH_TOKEN}@github.com/${REMOTE_REPO}.git" main:main

if ! GH_TOKEN="${GH_TOKEN}" gh api "repos/${REMOTE_REPO}/pages" >/dev/null 2>&1; then
  GH_TOKEN="${GH_TOKEN}" gh api "repos/${REMOTE_REPO}/pages" -X POST -f source[branch]=main -f source[path]=/docs >/dev/null
else
  GH_TOKEN="${GH_TOKEN}" gh api "repos/${REMOTE_REPO}/pages" -X PUT -f source[branch]=main -f source[path]=/docs >/dev/null
fi

popd >/dev/null

echo "Published https://${REPO_OWNER}.github.io/${REPO_NAME}/"
