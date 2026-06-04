# Sassywasm

SIMD-accelerated approximate DNA string matching in the browser, powered by [sassy](https://github.com/RagnarGrootKoerkamp/sassy) compiled to WebAssembly.

## What it does

Sassywasm finds approximate matches of a short DNA pattern in a longer target sequence, reporting all positions where the pattern matches with at most *k* edit operations (substitutions, insertions, deletions). It runs entirely in the browser using WebAssembly SIMD.

## Usage

Visit the deployed app at: https://happykhan.github.io/Sassywasm/

Or build locally:

```bash
./build.sh
cd app && npm run preview
```

## Requirements (development)

- Rust toolchain (1.91+) with `wasm32-unknown-unknown` target
- wasm-pack
- Node.js 20+

## Architecture

```
sassy-wasm/     Rust wrapper crate: wasm-bindgen bindings around sassy
app/            Vite + React + TypeScript SPA
tests/          Correctness tests (WASM vs native CLI)
build.sh        One-command build script
MEMORY.md       Linear-memory limits, 4 GiB vs Memory64, browser support
```

## Memory

The default build targets `wasm32` and grows linear memory on demand up to the
wasm32 ceiling of **4 GiB** (no artificial cap). An experimental `wasm64` /
Memory64 build can address **beyond 4 GiB** (Chrome caps it at ~16 GB):

```bash
./build.sh --memory64
```

Memory64 ships in Chrome, is flagged in Firefox, and is not yet in Safari, so it
is an opt-in build rather than the public default. See [MEMORY.md](MEMORY.md).

## Correctness

CI runs the WASM search against the native sassy CLI on fixed test cases. Both must produce identical match positions and edit distances.

## Acknowledgements

- [sassy](https://github.com/RagnarGrootKoerkamp/sassy) by Rick Beeloo and Ragnar Groot Koerkamp
