# WebAssembly memory limits

This note records the investigation for issue #2 — _recompile with Wasm 3.0,
test whether the browser will allow memory use beyond 4 GiB_.

## TL;DR

- The **default (wasm32) build already grows linear memory on demand up to the
  wasm32 hard ceiling of 4 GiB.** There was never a sub-4 GiB cap to remove —
  the emitted module declares `max = unlimited`, so the allocator grows pages
  as needed and the only limit is the architectural 32-bit one.
- Going **beyond 4 GiB requires Memory64** (the 64-bit memory proposal, part of
  the feature set marketed as "Wasm 3.0"). It is now buildable end-to-end from
  this repo via `./build.sh --memory64`, and the resulting module runs
  correctly. **But it is opt-in only** because Safari has no Memory64
  implementation yet — shipping it as the public default would break Safari
  users on the GitHub Pages site.

## Before vs after

| | Memory type | Growth | Max addressable | Shippable today |
|---|---|---|---|---|
| **Before / default (`./build.sh`)** | wasm32 (32-bit) | on demand, no artificial cap | **4 GiB** (65536 × 64 KiB pages) | yes — all browsers |
| **After / opt-in (`./build.sh --memory64`)** | wasm64 / Memory64 (64-bit) | on demand, no artificial cap | **>4 GiB**, browser-capped at **~16 GB** | Chrome only (see below) |

The "before" memory section, decoded from the binary:

```
MEMORY flags=0x0  mem64=false  shared=false  initial=17 pages (~1 MiB)  max=unlimited
```

`max=unlimited` is the key: wasm-pack/wasm-bindgen does **not** emit a maximum,
so memory growth is already uncapped below 4 GiB. This is the Rust/wasm
equivalent of Emscripten's `ALLOW_MEMORY_GROWTH=1` with no 2 GiB cap — it is on
by default and nothing needed changing for the sub-4 GiB case.

The "after" (`--memory64`) memory section:

```
MEMORY flags=0x4  mem64=true   shared=false  initial=17 pages (~1 MiB)  max=unlimited
```

`mem64=true` is the 64-bit memory index. This module can address beyond 4 GiB.

## What changed in the compilation

Nothing changed for the default 32-bit build other than documentation — it
already does the right thing.

The new **`--memory64` path** in `build.sh`:

1. Compiles the crate for the `wasm64-unknown-unknown` target. This is a Tier 3
   target with **no prebuilt standard library**, so it requires Rust **nightly**
   plus `-Z build-std=std,panic_abort` to build std from source. The whole
   `sassy` dependency tree (sassy, serde, serde-wasm-bindgen, wide, rayon, …)
   compiles cleanly for wasm64.
2. Runs `wasm-bindgen` (matched to the lockfile version) directly on the
   resulting `.wasm`. wasm-bindgen ≥ 0.2.121 supports the wasm64 ABI — `usize`
   and pointers are lowered through the JS-number (f64) ABI — and **preserves
   the 64-bit memory type** in its output.
3. **Skips `wasm-opt`.** The binaryen bundled with the installed wasm-pack
   (v117) cannot parse the 64-bit `funcref` table wasm-bindgen emits
   (`Tables may not be 64-bit`). The unoptimised module is correct; re-enable
   `wasm-opt --enable-memory64` once binaryen ≥ 119 is available on PATH.

All five exported functions (`search`, `search_rc`, `search_iupac`,
`search_iupac_rc`, `count`) were run against the wasm64 build and returned
results identical to the 32-bit build.

## Browser compatibility (as of June 2026)

| Browser | Memory64 support |
|---|---|
| **Chrome / Edge (Chromium)** | shipped, on by default. Web cap is **16 GB**. |
| **Firefox** | implemented but **behind a flag** (`javascript.options.wasm_memory64`). |
| **Safari** | **no implementation.** Apple removed its objection to the proposal in late 2025 but has not shipped it. |

Because Safari (and default Firefox) cannot instantiate a Memory64 module, the
64-bit build must not be the public default. The recommended pattern when the
time comes to use it in production is **runtime feature detection** — probe
whether a 64-bit `WebAssembly.Memory` can be constructed and fall back to the
32-bit module otherwise. The app already logs the loaded module's memory type
to the in-page console (`reportMemory` in `app/src/App.tsx`) so the active
ceiling is visible at runtime.

## Practical limit now

- **Default deployed app:** up to **4 GiB** of linear memory, all browsers.
- **Memory64 build, in Chrome:** up to ~**16 GB** of linear memory.

For Sassywasm's actual workload — a pattern string plus one target sequence
plus match/CIGAR output — 4 GiB already accommodates very large inputs (a human
chromosome is ~250 MB of sequence). The >4 GiB capability is therefore a
forward-looking option for whole-genome / multi-gigabyte targets rather than a
present bottleneck, which is why it is shipped as an opt-in build rather than
switched on by default.

## How to build the experimental >4 GiB module

```bash
./build.sh --memory64            # build wasm64 module + app
./build.sh --memory64 --skip-app # build wasm64 module only
```

Test it in a Memory64-capable runtime (Chrome, or Node ≥ 22):

```bash
node tests/wasm_tests.mjs
```
