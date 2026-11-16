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

for target in classic remastered; do
  if [ "${1:-all}" != all ] && [ "${1}" != "${target}" ]; then continue; fi
  target_dir="${BUILD_DIR}/${target}"
  mkdir -p "${target_dir}"
  rm -f "${target_dir}/openbw" "${target_dir}/sdl" "${target_dir}/dlmalloc"
  extra_flags=()
  if [ "${target}" = classic ]; then
    destination="${OUTPUT_DIR}"
    factory="createClassicReplayEngine"
  else
    destination="${OUTPUT_DIR}/remastered"
    factory="createRemasteredReplayEngine"
    extra_flags=(-DOPENBW_REMASTERED_RUNTIME -s USE_ZLIB=1)
  fi
  mkdir -p "${destination}"
  ln -s "${ROOT_DIR}" "${target_dir}/openbw"
  ln -s "${WRAPPER_DIR}/build/sdl" "${target_dir}/sdl"
  ln -s "${WRAPPER_DIR}/build/dlmalloc" "${target_dir}/dlmalloc"
  pushd "${target_dir}" >/dev/null
em++ -std=c++14 \
  -I "openbw/engines/${target}" -I openbw/ -I sdl/ \
  "${extra_flags[@]}" \
  -ferror-limit=2 -Wno-deprecated -O3 --bind -DOPENBW_NO_SDL_MIXER -D USE_DL_PREFIX -DMSPACES -DFOOTERS -g1 \
  -s ASM_JS=1 -s USE_SDL=2 -s TOTAL_MEMORY=201326592 -s INVOKE_RUN=0 -s USE_SDL_IMAGE=2 \
  -s SDL2_IMAGE_FORMATS="['png']" -s DISABLE_EXCEPTION_CATCHING=0 -s ASSERTIONS=0 -s ABORTING_MALLOC=0 \
  -s DISABLE_DEPRECATED_FIND_EVENT_TARGET_BEHAVIOR=1 \
  -s MODULARIZE=1 -s EXPORT_NAME="${factory}" \
  --post-js "${ROOT_DIR}/scripts/replay-runtime-lifecycle.js" \
  -s EXTRA_EXPORTED_RUNTIME_METHODS="['callMain','UTF8ToString']" \
  -s EXPORTED_FUNCTIONS="['_main','_ui_resize','_ui_can_resize','_ui_set_minimap_reference_size','_ui_get_screen_pos','_ui_set_screen_center','_ui_set_screen_center_manual','_ui_get_present_count','_ui_force_static_redraw','_replay_get_value','_replay_set_value','_observer_get_value','_observer_get_mode','_observer_set_mode','_observer_set_value','_fog_of_war_get_value','_fog_of_war_vision_get_value','_fog_of_war_set_value','_fog_of_war_player_get_value','_fog_of_war_player_set_value','_force_red_blue_colors_get_value','_force_red_blue_colors_set_value','_player_get_value','_load_replay']" \
  -o openbw.js \
  openbw/ui/sdl2.cpp openbw/ui/gfxtest.cpp dlmalloc/malloc.c
  popd >/dev/null
  sed -i '${/^[[:space:]]*$/d;}' "${target_dir}/openbw.js"
  cp "${target_dir}/openbw.js" "${destination}/openbw.js"
  cp "${target_dir}/openbw.wasm" "${destination}/openbw.wasm"
  echo "Updated ${destination}/openbw.js and openbw.wasm"
done
