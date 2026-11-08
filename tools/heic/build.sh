#!/usr/bin/env bash
set -euo pipefail
trap 'chown -R "${OUTPUT_UID:-0}:${OUTPUT_GID:-0}" /output /build' EXIT
export LC_ALL=C TZ=UTC SOURCE_DATE_EPOCH=0 EM_NODE_JS=/usr/local/bin/node EMCC_CORES=1 BINARYEN_CORES=1
export EM_CACHE=/build/em-cache
[[ -d "$EM_CACHE" ]] || cp -a /emsdk/upstream/emscripten/cache "$EM_CACHE"
emcc --version | grep -F '4.0.10' >/dev/null
[[ "$(node --version)" == v24.22.1 ]]
mode=${1:-original}
[[ "$mode" == original || "$mode" == probe ]] || exit 2
mkdir -p /build/heic-to /build/libheif /build/output
cd /build
tar -xf /inputs/heic-to.tar.gz -C heic-to
tar -xf /inputs/libheif.tar.gz -C libheif
git -C libheif apply /recipe/libheif-emscripten-4.0.10.patch
# Never use the precompiled upstream inputs, even if a build below fails.
rm -f heic-to/src/lib/libheif*.js
if [[ "$mode" == probe ]]; then
  python3 - <<'PY'
p='libheif/libheif/api/libheif/heif_library.cc'
s=open(p).read(); assert 'return (LIBHEIF_VERSION);' in s
open(p,'w').write(s.replace('return (LIBHEIF_VERSION);','return (LIBHEIF_VERSION "-miroven-probe-heif");'))
p='libheif/post.js'
s=open(p).read()
open(p,'w').write(s+'\nModule.mirovenProbe = () => [UTF8ToString(_heif_get_version()), UTF8ToString(_de265_get_version())];\n')
p='heic-to/src/worker.js'
s=open(p).read(); needle='const libheif = buildLibheif()'; assert needle in s
s=s.replace(needle, needle+'\nconst versions = libheif.mirovenProbe();\nif (!versions[0].endsWith("-miroven-probe-heif") || !versions[1].endsWith("-miroven-probe-de265")) throw new Error("Native probe failed");\nconsole.info("MIROVEN_NATIVE_PROBE", versions.join(","));')
open(p,'w').write(s)
PY
fi
for variant in regular csp; do
  mkdir -p /build/regular
  cd /build/regular
  if [[ ! -d libde265-1.0.16 ]]; then
  cp /inputs/libde265.tar.gz libde265-1.0.16.tar.gz
  tar -xf libde265-1.0.16.tar.gz
  if [[ "$mode" == probe ]]; then
    python3 - <<'PY'
p='libde265-1.0.16/libde265/de265.cc'
s=open(p).read(); assert 'return (LIBDE265_VERSION);' in s
open(p,'w').write(s.replace('return (LIBDE265_VERSION);','return (LIBDE265_VERSION "-miroven-probe-de265");'))
PY
    # The upstream script extracts the archive: replace it with our modified source.
    tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner -czf libde265-1.0.16.tar.gz libde265-1.0.16
  fi
  fi
  unsafe=1; target=libheif.js
  if [[ "$variant" == csp ]]; then unsafe=0; target=libheif-without-unsafe-eval.js; fi
  LIBDE265_VERSION=1.0.16 ENABLE_LIBDE265=1 ENABLE_AOM=0 ENABLE_WEBCODECS=0 ENABLE_OPENJPEG=0 ENABLE_UNCOMPRESSED=0 \
    USE_WASM=0 USE_UNSAFE_EVAL=$unsafe USE_TYPESCRIPT=0 USE_ES6=0 CORES=2 \
    /build/libheif/build-emscripten.sh /build/libheif
  python3 - "$target" <<'PYCODE'
import sys
s=open('libheif.js').read()
body, marker, _ = s.rpartition("\nif (typeof exports === 'object' && typeof module === 'object') {")
assert marker, 'Expected Emscripten CommonJS/AMD export adapter'
open('/build/heic-to/src/lib/'+sys.argv[1], 'w').write(body+'\nexport default libheif;\n')
PYCODE
done
cd /build/heic-to
cp -a /opt/wrapper/node_modules ./
node esbuild.mjs
cp dist/csp/heic-to.js /build/output/heic-to.js
cp dist/csp/heic-to.d.ts /build/output/heic-to.d.ts
# Native intermediates are evidence only, not separately loaded runtime libraries.
sha256sum src/lib/libheif*.js > /build/output/native-sha256.txt
if [[ "$mode" == probe ]]; then
  grep -q miroven-probe-heif dist/csp/heic-to.js
  grep -q miroven-probe-de265 dist/csp/heic-to.js
fi
emcc --version > /build/output/toolchain.txt
node --version >> /build/output/toolchain.txt
cmake --version >> /build/output/toolchain.txt
cp /build/output/* /output/
chown -R "${OUTPUT_UID:-0}:${OUTPUT_GID:-0}" /output /build
