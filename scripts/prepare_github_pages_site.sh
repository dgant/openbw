#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKSPACE_DIR="$(cd "${ROOT_DIR}/.." && pwd)"
WRAPPER_DIR="${WORKSPACE_DIR}/openbw-replay-viewer"
DOCS_DIR="${WRAPPER_DIR}/docs"

"${ROOT_DIR}/scripts/build_replay_viewer.sh"

if [ ! -d "${WRAPPER_DIR}/.git" ]; then
  echo "Missing wrapper repo at ${WRAPPER_DIR}" >&2
  exit 1
fi

touch "${DOCS_DIR}/.nojekyll"

cat <<EOF
Prepared GitHub Pages site in:
  ${DOCS_DIR}

Updated artifacts:
  ${DOCS_DIR}/v1.4/openbw.js
  ${DOCS_DIR}/v1.4/openbw.wasm
EOF
