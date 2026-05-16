/**
 * Self-contained WASM function tests.
 * Run: node tests/wasm_tests.mjs
 * No native sassy CLI required — loads the built WASM binary directly.
 */
import { readFile } from 'fs/promises'

const wasmPkg = await import('../sassy-wasm/pkg/sassy_wasm.js')
const wasmBytes = await readFile(new URL('../sassy-wasm/pkg/sassy_wasm_bg.wasm', import.meta.url))
await wasmPkg.default(wasmBytes)

const { search, search_rc, search_iupac, search_iupac_rc, count } = wasmPkg

let passed = 0
let failed = 0

function run(name, fn) {
  process.stdout.write(`  ${name} ... `)
  try {
    fn()
    console.log('PASS')
    passed++
  } catch (e) {
    console.log(`FAIL: ${e.message}`)
    failed++
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

// ── search ──────────────────────────────────────────────────────────────────
console.log('\nsassy search (forward DNA)')

run('exact match returns 1 result at correct position', () => {
  const r = search('ATCGATCG', 'AAAAAATCGATCGAAAAA', 0)
  assert(r.length === 1, `expected 1, got ${r.length}`)
  assert(r[0].pos === 5, `expected pos 5, got ${r[0].pos}`)
  assert(r[0].end === 13, `expected end 13, got ${r[0].end}`)
  assert(r[0].distance === 0, `expected dist 0, got ${r[0].distance}`)
  assert(r[0].strand === 'fwd', `expected strand fwd, got ${r[0].strand}`)
  assert(r[0].matched_seq === 'ATCGATCG', `expected ATCGATCG, got ${r[0].matched_seq}`)
})

run('one substitution found at k=1', () => {
  const r = search('ATCGATCG', 'AAAAAATCAATCGAAAAA', 1)
  assert(r.length >= 1, `expected ≥1, got ${r.length}`)
  assert(r[0].distance <= 1, `expected dist ≤1, got ${r[0].distance}`)
})

run('no match at k=0 returns empty', () => {
  const r = search('ATCGATCG', 'GGGGGGGGGGGGGGGGGG', 0)
  assert(r.length === 0, `expected 0, got ${r.length}`)
})

run('two non-overlapping exact matches', () => {
  const r = search('ATCGATCG', 'ATCGATCGAAAAAAATCGATCG', 0)
  assert(r.length === 2, `expected 2, got ${r.length}`)
})

run('CIGAR is present and non-empty', () => {
  const r = search('ATCGATCG', 'TTTATCGATCGTTT', 0)
  assert(r.length >= 1, 'expected ≥1 match')
  assert(typeof r[0].cigar === 'string' && r[0].cigar.length > 0, 'expected non-empty cigar')
})

// ── search_rc ───────────────────────────────────────────────────────────────
console.log('\nsassy search_rc (forward + reverse complement)')

run('forward match reported as fwd strand', () => {
  const r = search_rc('ATCGATCG', 'AAATCGATCGAAA', 0)
  assert(r.length >= 1, `expected ≥1, got ${r.length}`)
  const fwd = r.find(m => m.strand === 'fwd')
  assert(fwd !== undefined, 'expected a fwd-strand result')
  assert(fwd.distance === 0, `expected dist 0, got ${fwd.distance}`)
})

run('reverse-complement match reported at original coordinates', () => {
  // RC of ATCGATCG = CGATCGAT; place it at the start of text
  // text = CGATCGATAAA (length 11)
  // RC of text = TTTATCGATCG; ATCGATCG is at RC-pos 3..11
  // → original pos = 11 - 11 = 0, end = 11 - 3 = 8, strand = rc
  const r = search_rc('ATCGATCG', 'CGATCGATAAA', 0)
  assert(r.length >= 1, `expected ≥1, got ${r.length}`)
  const rc = r.find(m => m.strand === 'rc')
  assert(rc !== undefined, 'expected an rc-strand result')
  assert(rc.pos === 0, `expected pos 0, got ${rc.pos}`)
  assert(rc.end === 8, `expected end 8, got ${rc.end}`)
  assert(rc.distance === 0, `expected dist 0, got ${rc.distance}`)
})

run('reports matches on both strands simultaneously', () => {
  // Text has pattern on fwd AND its RC on the same text
  // ATCGATCG + spacer + CGATCGAT (RC of ATCGATCG)
  const r = search_rc('ATCGATCG', 'ATCGATCGAAAACGATCGAT', 0)
  const fwdCount = r.filter(m => m.strand === 'fwd').length
  const rcCount = r.filter(m => m.strand === 'rc').length
  assert(fwdCount >= 1, 'expected ≥1 fwd match')
  assert(rcCount >= 1, 'expected ≥1 rc match')
})

// ── search_iupac ─────────────────────────────────────────────────────────────
console.log('\nsassy search_iupac (forward IUPAC pattern)')

run('N matches any base (A)', () => {
  const r = search_iupac('NATCG', 'TTAATCGTT', 0)
  assert(r.length >= 1, `expected ≥1, got ${r.length}`)
  assert(r[0].pos === 2, `expected pos 2, got ${r[0].pos}`)
  assert(r[0].distance === 0, `expected dist 0, got ${r[0].distance}`)
})

run('R (A|G) matches G', () => {
  const r = search_iupac('RATCG', 'TTGATCGTT', 0)
  assert(r.length >= 1, `expected ≥1, got ${r.length}`)
  assert(r[0].distance === 0, `expected dist 0, got ${r[0].distance}`)
})

run('Y (C|T) matches C', () => {
  const r = search_iupac('YATCG', 'TTCATCGTT', 0)
  assert(r.length >= 1, `expected ≥1, got ${r.length}`)
  assert(r[0].distance === 0, `expected dist 0, got ${r[0].distance}`)
})

run('pure-ACGT pattern works (identical to search)', () => {
  const ri = search_iupac('ATCGATCG', 'AAATCGATCGAAA', 0)
  const rs = search('ATCGATCG', 'AAATCGATCGAAA', 0)
  assert(ri.length === rs.length, `iupac ${ri.length} vs search ${rs.length}`)
})

// ── search_iupac_rc ────────────────────────────────────────────────────────
console.log('\nsassy search_iupac_rc (IUPAC + both strands — CRISPR)')

run('REGRESSION: N in PAM does not cause WASM unreachable trap', () => {
  // This exact pattern crashed with "unreachable" before fix
  // (Dna profile rejects N; Iupac profile handles it correctly)
  const r = search_iupac_rc('ATCGATCGATCGATCGATCGNGG', 'TTATCGATCGATCGATCGATCGGGG', 0)
  assert(Array.isArray(r), 'expected array, got crash')
})

run('NGG PAM found on forward strand with exact match', () => {
  // pattern = guide(20) + NGG; text has guide + CGG → N matches C, perfect match
  const r = search_iupac_rc('ATCGATCGATCGATCGATCGNGG', 'TTATCGATCGATCGATCGATCGCGGATCG', 0)
  assert(r.length >= 1, `expected ≥1, got ${r.length}`)
  const fwd = r.find(m => m.strand === 'fwd')
  assert(fwd !== undefined, 'expected fwd match')
  assert(fwd.distance === 0, `expected dist 0, got ${fwd.distance}`)
})

run('all-N pattern matches any k-mer on both strands', () => {
  const r = search_iupac_rc('NNNNNNNN', 'ATCGATCGATCG', 0)
  assert(Array.isArray(r), 'expected array')
  assert(r.length >= 1, `expected ≥1, got ${r.length}`)
})

run('no match when text is too short for pattern', () => {
  const r = search_iupac_rc('ATCGATCGATCGATCGATCGNGG', 'ATCG', 0)
  assert(Array.isArray(r), 'expected array')
  assert(r.length === 0, `expected 0, got ${r.length}`)
})

// ── count ────────────────────────────────────────────────────────────────────
console.log('\nsassy count (fast count, no positions)')

run('counts two non-overlapping exact matches', () => {
  const n = count('ATCGATCG', 'ATCGATCGAAAATCGATCG', 0)
  assert(n === 2, `expected 2, got ${n}`)
})

run('returns 0 when no match', () => {
  const n = count('ATCGATCG', 'GGGGGGGGGGGG', 0)
  assert(n === 0, `expected 0, got ${n}`)
})

run('k=1 catches single-substitution match', () => {
  const n = count('ATCGATCG', 'ATCAATCGGGGGG', 1)
  assert(n >= 1, `expected ≥1 with k=1, got ${n}`)
})

run('returns 0 for k=0 when only near-match exists', () => {
  const n = count('ATCGATCG', 'ATCAATCGGGGGG', 0)
  assert(n === 0, `expected 0 at k=0, got ${n}`)
})

// ── Summary ───────────────────────────────────────────────────────────────────
const total = passed + failed
console.log(`\n=== ${total} tests: ${passed} passed, ${failed} failed ===\n`)
if (failed > 0) process.exit(1)
