#!/usr/bin/env sh
# Downloads the one big AR file that is not stored in this repo (14 MB):
#   site/assets/ar/vendor/mediapipe/wasm/vision_wasm_internal.wasm
# It is the unmodified file from the npm package @mediapipe/tasks-vision 1.2.0 (Apache 2.0).
# Run from the store/ folder:  sh tools/fetch-vendor.sh
set -e
OUT=site/assets/ar/vendor/mediapipe/wasm/vision_wasm_internal.wasm
SHA=bcc13df22d3d69ec8cbe8e280989356d844ae00f4523eb82072d2484f44134dc
TMP=$(mktemp -d)
( cd "$TMP" && npm pack @mediapipe/tasks-vision@1.2.0 --silent >/dev/null && tar xzf mediapipe-tasks-vision-1.2.0.tgz )
cp "$TMP/package/wasm/vision_wasm_internal.wasm" "$OUT"
rm -rf "$TMP"
echo "$SHA  $OUT" | sha256sum -c -
echo "OK: $OUT"
