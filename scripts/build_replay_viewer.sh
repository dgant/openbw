#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DESKTOP_DIR="${ROOT_DIR}/../openbw-replay-viewer/desktop"

"${ROOT_DIR}/scripts/build_web_replay_viewer.sh"

# Package exactly the docs/ files just built for local browser testing.
cd "${DESKTOP_DIR}"
if [ ! -f node_modules/@neutralinojs/neu/bin/neu.js ]; then
  npm ci --no-fund
fi
if [ ! -f bin/neutralino-win_x64.exe ] || [ ! -f www/neutralino.js ]; then
  npm run setup
fi
npm run build
