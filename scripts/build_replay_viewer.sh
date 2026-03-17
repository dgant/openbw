#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKSPACE_DIR="$(cd "${ROOT_DIR}/.." && pwd)"
WRAPPER_DIR="${WORKSPACE_DIR}/openbw-replay-viewer"
BUILD_DIR="${WORKSPACE_DIR}/.build/openbw-web"
OUTPUT_DIR="${WRAPPER_DIR}/docs/v1.4"

if [ ! -f /opt/emsdk/emsdk_env.sh ]; then
  echo "Missing /opt/emsdk/emsdk_env.sh. Rebuild the dev container to install emsdk." >&2
  exit 1
fi

. /opt/emsdk/emsdk_env.sh >/dev/null

mkdir -p "${BUILD_DIR}"
rm -f "${BUILD_DIR}/openbw" "${BUILD_DIR}/sdl" "${BUILD_DIR}/dlmalloc"
ln -s "${ROOT_DIR}" "${BUILD_DIR}/openbw"
ln -s "${WRAPPER_DIR}/build/sdl" "${BUILD_DIR}/sdl"
ln -s "${WRAPPER_DIR}/build/dlmalloc" "${BUILD_DIR}/dlmalloc"

pushd "${BUILD_DIR}" >/dev/null
em++ -std=c++14 \
  -I openbw/ -I sdl/ \
  -ferror-limit=2 -O3 --bind -DOPENBW_NO_SDL_MIXER -D USE_DL_PREFIX -DMSPACES -DFOOTERS -g1 \
  -s ASM_JS=1 -s USE_SDL=2 -s TOTAL_MEMORY=201326592 -s INVOKE_RUN=0 -s USE_SDL_IMAGE=2 \
  -s SDL2_IMAGE_FORMATS="['png']" -s DISABLE_EXCEPTION_CATCHING=1 -s ASSERTIONS=1 -s ABORTING_MALLOC=0 \
  -s EXPORTED_FUNCTIONS="['_main','_ui_resize','_replay_get_value','_replay_set_value','_player_get_value','_load_replay']" \
  -o openbw.html \
  openbw/ui/sdl2.cpp openbw/ui/gfxtest.cpp dlmalloc/malloc.c
popd >/dev/null

cp "${BUILD_DIR}/openbw.js" "${OUTPUT_DIR}/openbw.js"
cp "${BUILD_DIR}/openbw.wasm" "${OUTPUT_DIR}/openbw.wasm"

echo "Updated ${OUTPUT_DIR}/openbw.js and openbw.wasm"
