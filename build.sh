#!/usr/bin/env bash
set -euo pipefail

# Sassywasm build script.
#
# Default: builds the 32-bit (wasm32) module via wasm-pack. This is the
# shippable, cross-browser target. Linear memory grows on demand up to the
# wasm32 hard ceiling of 4 GiB (65536 x 64 KiB pages) — no artificial cap is
# imposed, so growth is already unbounded below 4 GiB.
#
# --memory64: builds the experimental 64-bit (wasm64 / Memory64) module, which
# can address beyond 4 GiB (browsers cap it at ~16 GB). This requires a Rust
# nightly toolchain with -Z build-std because wasm64-unknown-unknown is a
# Tier 3 target with no prebuilt std. Chrome ships Memory64; Firefox is behind
# a flag; Safari has no implementation yet (see MEMORY.md). Do NOT deploy the
# wasm64 build as the public default until Safari support lands.
#
# Usage:
#   ./build.sh              # 32-bit build + app (default, shippable)
#   ./build.sh --memory64   # 64-bit experimental build + app
#   ./build.sh --skip-app   # build the wasm module only, skip npm/app build

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

MEMORY64=0
SKIP_APP=0
for arg in "$@"; do
  case "$arg" in
    --memory64) MEMORY64=1 ;;
    --skip-app) SKIP_APP=1 ;;
    *) echo "unknown argument: $arg" >&2; exit 1 ;;
  esac
done

# Ensure cargo/rustup are on PATH
if [ -f "$HOME/.cargo/env" ]; then
  source "$HOME/.cargo/env"
fi

if [ "$MEMORY64" -eq 1 ]; then
  echo "==> Building sassy-wasm (EXPERIMENTAL wasm64 / Memory64, >4 GiB capable)..."
  cd "$SCRIPT_DIR/sassy-wasm"

  TARGET="wasm64-unknown-unknown"

  # wasm64-unknown-unknown has no prebuilt std; build it from source on nightly.
  echo "    ensuring nightly toolchain + rust-src + wasm-bindgen-cli..."
  rustup toolchain install nightly --profile minimal >/dev/null 2>&1 || true
  rustup component add rust-src --toolchain nightly >/dev/null 2>&1 || true
  WASM_BINDGEN_VERSION="$(grep -A1 'name = "wasm-bindgen"' Cargo.lock | grep version | head -1 | sed -E 's/.*"([0-9.]+)".*/\1/')"
  if ! wasm-bindgen --version 2>/dev/null | grep -q "$WASM_BINDGEN_VERSION"; then
    echo "    installing wasm-bindgen-cli $WASM_BINDGEN_VERSION..."
    cargo install wasm-bindgen-cli --version "$WASM_BINDGEN_VERSION" >/dev/null 2>&1
  fi

  echo "    compiling crate for $TARGET (build-std)..."
  RUSTFLAGS="-C target-feature=+simd128" \
    cargo +nightly build --release --target "$TARGET" \
      -Z build-std=std,panic_abort

  WASM_IN="target/$TARGET/release/sassy_wasm.wasm"
  echo "    running wasm-bindgen on $WASM_IN..."
  # wasm-opt is skipped: the binaryen bundled with wasm-pack (v117) cannot yet
  # parse 64-bit tables emitted by wasm-bindgen. The unoptimised module is
  # correct; re-enable wasm-opt with --enable-memory64 once binaryen >=119 is
  # on PATH.
  rm -rf pkg
  wasm-bindgen --target web --out-dir pkg "$WASM_IN"

  echo "    wasm64 module written to pkg/ (memory type: 64-bit)"
else
  echo "==> Building sassy-wasm (wasm32, shippable, grows to 4 GiB)..."
  cd "$SCRIPT_DIR/sassy-wasm"
  RUSTFLAGS="-C target-feature=+simd128" wasm-pack build --target web
fi

if [ "$SKIP_APP" -eq 1 ]; then
  echo "==> Skipping app build (--skip-app). WASM module is in sassy-wasm/pkg/."
  exit 0
fi

echo "==> Installing app dependencies..."
cd "$SCRIPT_DIR/app"
npm install

echo "==> Building app..."
npm run build

echo "==> Done. Output in app/dist/"
