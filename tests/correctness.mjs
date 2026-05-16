/**
 * Correctness test: compare sassy-wasm output against native sassy CLI.
 *
 * Expects:
 *   - sassy CLI installed and on PATH
 *   - sassy-wasm built (../sassy-wasm/pkg/)
 *
 * Writes temporary FASTA files, runs both native and WASM, compares results.
 */

import { execSync } from 'child_process'
import { writeFileSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { readFile } from 'fs/promises'

// Load test cases
const testCases = JSON.parse(
  await readFile(new URL('./test_cases.json', import.meta.url), 'utf-8')
)

/**
 * Run native sassy CLI search and parse TSV output.
 * Returns array of {start, end, cost, matched_seq, cigar}.
 */
function runNative(pattern, text, k) {
  const tmp = mkdtempSync(join(tmpdir(), 'sassy-test-'))
  const textFile = join(tmp, 'text.fasta')
  writeFileSync(textFile, `>text\n${text}\n`)

  try {
    // Use --no-rc to match our forward-only WASM search
    const cmd = `sassy search -p ${pattern} -k ${k} --no-rc -a dna ${textFile}`
    const output = execSync(cmd, { encoding: 'utf-8', timeout: 30000 })

    const lines = output.trim().split('\n')
    // First line is the header
    const results = []
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split('\t')
      if (parts.length < 8) continue
      results.push({
        cost: parseInt(parts[2], 10),
        start: parseInt(parts[4], 10),
        end: parseInt(parts[5], 10),
        matched_seq: parts[6],
        cigar: parts[7],
      })
    }
    return results
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

/**
 * Run WASM search via dynamic import of the built package.
 * Returns array of {start, end, cost, matched_seq, cigar}.
 */
async function runWasm(pattern, text, k) {
  // We need to load the WASM in Node.js context
  const wasmPkg = await import('../sassy-wasm/pkg/sassy_wasm.js')

  // Read the wasm file and instantiate
  const wasmPath = new URL('../sassy-wasm/pkg/sassy_wasm_bg.wasm', import.meta.url)
  const wasmBytes = await readFile(wasmPath)
  await wasmPkg.default(wasmBytes)

  const results = wasmPkg.search(pattern, text, k)
  return results.map((m) => ({
    cost: m.distance,
    start: m.pos,
    end: m.end,
    matched_seq: m.matched_seq,
    cigar: m.cigar,
  }))
}

// Run tests
let passed = 0
let failed = 0

for (const tc of testCases) {
  console.log(`\nTest: ${tc.name}`)
  console.log(`  Pattern: ${tc.pattern}, k=${tc.k}`)

  let nativeResults, wasmResults

  try {
    nativeResults = runNative(tc.pattern, tc.text, tc.k)
  } catch (e) {
    console.log(`  SKIP (native sassy failed): ${e.message}`)
    continue
  }

  try {
    wasmResults = await runWasm(tc.pattern, tc.text, tc.k)
  } catch (e) {
    console.log(`  FAIL (WASM error): ${e.message}`)
    failed++
    continue
  }

  console.log(`  Native: ${nativeResults.length} matches`)
  console.log(`  WASM:   ${wasmResults.length} matches`)

  // Compare: for each native match, check that WASM has a match at the same position with same cost
  // Note: ordering may differ; compare as sets by (start, cost)
  const nativeSet = new Set(nativeResults.map((r) => `${r.start}:${r.end}:${r.cost}`))
  const wasmSet = new Set(wasmResults.map((r) => `${r.start}:${r.end}:${r.cost}`))

  let testPassed = true

  for (const key of nativeSet) {
    if (!wasmSet.has(key)) {
      console.log(`  MISMATCH: native has ${key} but WASM does not`)
      testPassed = false
    }
  }

  for (const key of wasmSet) {
    if (!nativeSet.has(key)) {
      console.log(`  MISMATCH: WASM has ${key} but native does not`)
      testPassed = false
    }
  }

  if (testPassed) {
    console.log(`  PASS`)
    passed++
  } else {
    // Print details for debugging
    console.log(`  Native results:`, JSON.stringify(nativeResults, null, 2))
    console.log(`  WASM results:`, JSON.stringify(wasmResults, null, 2))
    failed++
  }
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`)

if (failed > 0) {
  process.exit(1)
}
