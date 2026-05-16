#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Ensure cargo/rustup are on PATH
if [ -f "$HOME/.cargo/env" ]; then
  source "$HOME/.cargo/env"
fi

echo "==> Building sassy-wasm..."
cd "$SCRIPT_DIR/sassy-wasm"
RUSTFLAGS="-C target-feature=+simd128" wasm-pack build --target web

echo "==> Installing app dependencies..."
cd "$SCRIPT_DIR/app"
npm install

echo "==> Building app..."
npm run build

echo "==> Done. Output in app/dist/"
