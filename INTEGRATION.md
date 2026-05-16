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
import init, { search } from '/sassy_wasm.js'

// Initialise once (loads and compiles the WASM binary)
await init()

// Run a search
const matches = search('ATCGATCG', 'TTTATCGATCGAAATCGATCA', 1)
// matches: Array<{ pos: number, end: number, distance: number, matched_seq: string, cigar: string }>
console.log(matches)
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

### `search(pattern: string, text: string, k: number): MatchResult[]`

Searches for all approximate occurrences of `pattern` in `text` with at most `k` errors (mismatches + indels).

**Parameters:**
- `pattern` — query sequence, uppercase DNA (ACGT only)
- `text` — target sequence, uppercase DNA (ACGT only)
- `k` — maximum edit distance (0 = exact match, 5 = very fuzzy)

**Returns:** array of match objects:

```typescript
interface MatchResult {
  pos: number         // 0-based start position in text
  end: number         // 0-based end position (exclusive)
  distance: number    // edit distance from pattern to matched substring
  matched_seq: string // substring of text that was matched
  cigar: string       // CIGAR string (M = match, I = insertion, D = deletion)
}
```

## Building from source

If you need to rebuild the WASM (e.g. to update the sassy version):

```bash
git clone https://github.com/happykhan/Sassywasm
cd Sassywasm
RUSTFLAGS="-C target-feature=+simd128" wasm-pack build sassy-wasm --target web
# Output: sassy-wasm/pkg/
```

Requires Rust stable + `wasm-pack` + the `wasm32-unknown-unknown` target.
