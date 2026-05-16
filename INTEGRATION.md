# Integrating sassy-wasm into Another Tool

This document explains how to use the pre-built WASM and JS files from Sassywasm in another web application.

## What you get

Each [GitHub release](https://github.com/happykhan/Sassywasm/releases) ships four files:

| File | Purpose |
|------|---------|
| `sassy_wasm.js` | ES module glue — initialises the WASM binary and exports the API |
| `sassy_wasm_bg.wasm` | Compiled WebAssembly binary (73 KB / 31 KB gzipped) |
| `sassy_wasm.d.ts` | TypeScript types for the JS module |
| `sassy_wasm_bg.wasm.d.ts` | TypeScript types for the WASM binary |

## Prerequisites

- **WASM SIMD128** must be enabled in the browser. All major browsers support this since 2021 (Chrome 91+, Firefox 89+, Safari 16.4+).
- The WASM binary must be served with `Content-Type: application/wasm` for streaming instantiation to work. Most web servers do this automatically.

## Option 1: Copy files into your project

Download the four files from the latest release and place them alongside your app's assets.

```
your-app/
  public/
    sassy_wasm.js
    sassy_wasm.d.ts
    sassy_wasm_bg.wasm
    sassy_wasm_bg.wasm.d.ts
```

Then import and use:

```typescript
import init, { search, search_rc, search_iupac, count } from '/sassy_wasm.js'

// Initialise once (loads and compiles the WASM binary)
await init()

// Forward-only DNA search
const fwdMatches = search('ATCGATCG', 'TTTATCGATCGAAATCGATCA', 1)
// returns: Array<{ pos, end, distance, matched_seq, cigar, strand: 'fwd' }>

// Forward + reverse complement search (both strands)
const rcMatches = search_rc('ATCG', 'CCCATCACCC', 1)
// returns matches with strand: 'fwd' or 'rc'

// IUPAC pattern search (R = A or G, Y = C or T, N = any, etc.)
const iupacMatches = search_iupac('ATCGRAATCG', 'TTTATCGAAATCG', 0)

// Fast count only — no position tracking, faster than search()
const n = count('ATCGATCG', 'ATCGATCGATCGATCG', 0)
// returns: number
```

## Option 2: Load from a GitHub release URL

Use jsDelivr to load directly from a specific release tag:

```html
<script type="module">
  import init, { search } from 'https://cdn.jsdelivr.net/gh/happykhan/Sassywasm@v0.1.0/sassy-wasm/pkg/sassy_wasm.js'
  await init('https://cdn.jsdelivr.net/gh/happykhan/Sassywasm@v0.1.0/sassy-wasm/pkg/sassy_wasm_bg.wasm')
  const matches = search('ATCGATCG', 'TTTATCGATCGAAA', 1)
</script>
```

Pin to a specific tag (e.g. `@v0.1.0`) rather than `@latest` to avoid breaking changes.

## Option 3: Vite app (recommended for GenomicX tools)

In your `vite.config.ts`:

```typescript
export default defineConfig({
  optimizeDeps: {
    exclude: ['sassy-wasm'],
  },
})
```

Copy the four files to `public/sassy-wasm/` and add a path alias:

```typescript
resolve: {
  alias: {
    'sassy-wasm': '/sassy-wasm/sassy_wasm.js',
  },
},
```

Then in your component:

```typescript
import init, { search } from 'sassy-wasm'

let ready = false

export async function initSassy() {
  if (ready) return
  await init()
  ready = true
}

export function runSearch(pattern: string, text: string, k: number) {
  return search(pattern.toUpperCase(), text.toUpperCase(), k)
}
```

## API reference

### `init(wasmUrl?: string): Promise<void>`

Loads and compiles the WASM binary. Call once before any other function. If `wasmUrl` is omitted, the binary is resolved relative to the JS file.

All search functions share this return type (except `count`):

```typescript
interface MatchResult {
  pos: number         // 0-based start position in text
  end: number         // 0-based end position (exclusive)
  distance: number    // edit distance from pattern to matched substring
  matched_seq: string // substring of text that was matched
  cigar: string       // CIGAR string (= match, X mismatch, I insertion, D deletion)
  strand: 'fwd' | 'rc'  // always 'fwd' for search() and search_iupac()
}
```

---

### `search(pattern: string, text: string, k: number): MatchResult[]`

Forward-only DNA search. Returns local-minima matches with edit distance ≤ k.

- `pattern` — uppercase DNA (ACGT only)
- `text` — uppercase DNA (ACGT only)
- `k` — max edit distance (0 = exact, 5 = very fuzzy)
- `strand` is always `'fwd'`

---

### `search_rc(pattern: string, text: string, k: number): MatchResult[]`

Forward **and** reverse-complement search. Reports matches on both strands.

- Same parameters as `search()`
- `strand` is `'fwd'` or `'rc'` per match
- Use when sequence orientation is unknown (e.g., raw sequencing reads)

---

### `search_iupac(pattern: string, text: string, k: number): MatchResult[]`

Forward search with IUPAC ambiguity codes in the **pattern**.

- `pattern` — uppercase IUPAC (ACGTRYMKSWHBDVN)
- `text` — uppercase DNA (ACGT only; no ambiguity in the text)
- Use for degenerate primer design or consensus motif searching

IUPAC codes: `R`=A/G, `Y`=C/T, `S`=G/C, `W`=A/T, `K`=G/T, `M`=A/C, `B`=not-A, `D`=not-C, `H`=not-G, `V`=not-T, `N`=any

---

### `count(pattern: string, text: string, k: number): number`

Fast match count. Returns the number of approximate matches without tracking positions, CIGAR, or matched sequences. Use when you only need to know if/how many matches exist.

- Same parameters as `search()`
- Substantially faster than `search()` for large texts — no backtracking step

## Building from source

### Prerequisites

- [Rust stable](https://rustup.rs/) with the `wasm32-unknown-unknown` target:
  ```bash
  rustup target add wasm32-unknown-unknown
  ```
- [wasm-pack](https://rustwasm.github.io/wasm-pack/installer/):
  ```bash
  cargo install wasm-pack
  ```

### Build

```bash
git clone https://github.com/happykhan/Sassywasm
cd Sassywasm
RUSTFLAGS="-C target-feature=+simd128" wasm-pack build sassy-wasm --target web
# Output: sassy-wasm/pkg/
```

### Compiling sassy yourself (Cargo.toml explained)

If you are wrapping sassy in your own crate, the dependency declaration in `Cargo.toml` requires two non-obvious settings:

```toml
[dependencies.sassy]
version = "0.2"
default-features = false   # removes the CLI feature, which pulls in needletail
features = ["scalar"]      # silences the AVX2/NEON compile-time check
```

**Why `default-features = false`?**
Sassy's default feature set includes `cli`, which pulls in `needletail` (a FASTA parser). `needletail` depends on native C libraries (`zstd`, `bzip2`, `liblzma`). These require a C cross-compiler for the WASM target and will fail to build without additional configuration. Since you are using the library API (not the CLI), you do not need `needletail`.

**Why `features = ["scalar"]`?**
Sassy uses the `ensure_simd` crate, which emits a `compile_error!` at build time unless your target supports AVX2 (x86_64) or NEON (aarch64). The `scalar` feature silences this check, allowing the build to proceed for `wasm32-unknown-unknown`. The `wide` crate that sassy uses internally will then use WASM SIMD128 instructions when `RUSTFLAGS="-C target-feature=+simd128"` is set — LLVM handles the translation from `wide`'s generic SIMD API to WASM SIMD128 vectors.

### Wrapper crate structure

The minimal `src/lib.rs` for a sassy WASM wrapper:

```rust
use wasm_bindgen::prelude::*;
use serde::Serialize;
use sassy::{Searcher, profiles::Dna};

#[derive(Serialize)]
struct MatchResult {
    pos: usize,
    end: usize,
    distance: i32,
    matched_seq: String,
    cigar: String,
}

#[wasm_bindgen]
pub fn search(pattern: &str, text: &str, k: u32) -> JsValue {
    let pattern_bytes = pattern.as_bytes();
    let text_bytes = text.as_bytes();

    let mut searcher = Searcher::<Dna>::new_fwd();
    let matches = searcher.search(pattern_bytes, text_bytes, k as usize);

    let results: Vec<MatchResult> = matches
        .iter()
        .map(|m| {
            let matched = std::str::from_utf8(&text_bytes[m.text_start..m.text_end])
                .unwrap_or("")
                .to_string();
            MatchResult {
                pos: m.text_start,
                end: m.text_end,
                distance: m.cost,
                matched_seq: matched,
                cigar: m.cigar.to_string(),
            }
        })
        .collect();

    serde_wasm_bindgen::to_value(&results).unwrap_or(JsValue::NULL)
}
```

And the full `Cargo.toml`:

```toml
[package]
name = "sassy-wasm"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
wasm-bindgen = "0.2"
serde = { version = "1", features = ["derive"] }
serde-wasm-bindgen = "0.6"

[dependencies.sassy]
version = "0.2"
default-features = false
features = ["scalar"]
```
