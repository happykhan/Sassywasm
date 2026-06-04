import { useState, useCallback } from 'react'
import { Routes, Route, Link } from 'react-router-dom'
import { AppShell, FileUpload, Alert, LogConsole } from '@genomicx/ui'
import { GenomesPage } from './genomes/GenomesPage'
import { RefGenomeSelector, type LoadedRef } from './genomes/RefGenomeSelector'
import { takeGenomeHandoff } from './genomes/handoff'
import { parseFasta, parseFastaFirst, cleanDna, cleanIupac } from './genomes/fasta'
import { BACTERIA } from './genomes/catalog'
import { fetchBacterialGenome } from './genomes/fetchGenome'
import './App.css'

const APP_VERSION = '0.1.0'

interface MatchResult {
  pos: number
  end: number
  distance: number
  matched_seq: string
  cigar: string
  strand: 'fwd' | 'rc'
}

type Mode = 'search' | 'grep' | 'filter' | 'crispr'

// Where the search target comes from: a fetched reference genome, or the
// user's own uploaded file / pasted text.
type TargetSource = 'reference' | 'upload'

// Real example genome used by the "Load sample data" button — fetched live via
// the same path as the reference picker so the demo exercises the full pipeline.
const SAMPLE_GENOME = BACTERIA.find((b) => b.id === 'ecoli-k12')!

const MODES: { value: Mode; label: string; cli: string; description: string }[] = [
  { value: 'search',  label: 'Search',  cli: 'sassy search',  description: 'Find all approximate matches and report positions, distances, and alignment.' },
  { value: 'grep',    label: 'Grep',    cli: 'sassy grep',    description: 'Show matches highlighted in sequence context — useful for visual inspection.' },
  { value: 'filter',  label: 'Filter',  cli: 'sassy filter',  description: 'Given multiple sequences (FASTA), return only those that match (or don\'t match) the pattern.' },
  { value: 'crispr',  label: 'CRISPR', cli: 'sassy crispr',  description: 'Find CRISPR guide RNA target sites with PAM sequence on both strands.' },
]

// Per-mode sample data. `search`, `grep` and `crispr` run against a real fetched
// reference genome (E. coli K-12), so only the pattern/PAM is seeded here; the
// target comes from SAMPLE_GENOME. `filter` operates on a multi-FASTA paste, so
// it still carries its own inline sequences.
const EXAMPLES: Record<Mode, { pattern: string; fasta?: string; pam?: string; k: number; strand?: 'fwd' | 'rc' }> = {
  search: {
    // A 24-mer from the E. coli K-12 thrA region — present in the real genome.
    pattern: 'ATGCGAGTGTTGAAGTTCGGCGGT',
    k:       1,
    strand:  'fwd',
  },
  grep: {
    pattern: 'ATGCGAGTGTTGAAGTTCGGCGGT',
    k:       1,
    strand:  'fwd',
  },
  filter: {
    pattern: 'ATCGATCG',
    fasta:   '>seq1 (matches)\nATCGATCGATCGATCG\n>seq2 (no match)\nGGGGGGGGGGGGGGGG\n>seq3 (1 error)\nATCGATTGATCGATCG\n>seq4 (no match)\nCCCCCCCCCCCCCCCC',
    k:       1,
    strand:  'fwd',
  },
  crispr: {
    pattern: 'ATGCGAGTGTTGAAGTTCGG',
    pam:     'NGG',
    k:       1,
  },
}

let wasmModule: Record<string, unknown> | null = null
async function loadWasm(addLog: (msg: string) => void): Promise<Record<string, unknown>> {
  if (wasmModule) { addLog('[wasm] already initialised'); return wasmModule }
  addLog('[wasm] loading sassy-wasm module…')
  const wasm = await import('sassy-wasm')
  addLog('[wasm] running init()…')
  await (wasm.default as () => Promise<void>)()
  wasmModule = wasm as unknown as Record<string, unknown>
  reportMemory(wasm as unknown as { memory?: WebAssembly.Memory }, addLog)
  addLog('[wasm] ready')
  return wasmModule
}

// Report the linear-memory type and current size of the loaded module.
// A 32-bit (wasm32) module can grow to at most 4 GiB; a 64-bit (Memory64)
// module can grow beyond 4 GiB (browsers cap it at ~16 GB). The buffer kind
// distinguishes them: SharedArrayBuffer vs ArrayBuffer is orthogonal, but the
// `maximum`-less growth and >4 GiB addressability come from the module's
// memory index type, baked in at compile time.
function reportMemory(
  mod: { memory?: WebAssembly.Memory },
  addLog: (msg: string) => void,
): void {
  const mem = mod.memory
  if (!mem || !(mem instanceof WebAssembly.Memory)) {
    addLog('[wasm] memory: not exported by module')
    return
  }
  const bytes = mem.buffer.byteLength
  const mb = (bytes / 2 ** 20).toFixed(1)
  // wasm32 modules can never exceed 4 GiB; if the live buffer is already at or
  // above that, the module must be Memory64. Below that we report the wasm32
  // ceiling and note that the true type is fixed at compile time.
  const over4gib = bytes >= 2 ** 32
  addLog(`[wasm] linear memory: ${mb} MiB in use`)
  addLog(
    over4gib
      ? '[wasm] Memory64 active — can grow beyond 4 GiB (browser caps ~16 GB)'
      : '[wasm] memory grows on demand; wasm32 ceiling is 4 GiB',
  )
  return
}

function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (ev) => resolve(ev.target?.result as string)
    reader.onerror = () => reject(reader.error ?? new Error('file read failed'))
    reader.readAsText(file)
  })
}

// Build IUPAC pattern: guide + PAM (e.g. NGG → '[ACGT]GG' in IUPAC = NGG)
function buildCrisprPattern(guide: string, pam: string): string {
  return cleanIupac(guide + pam)
}

// Highlight matches in the target sequence.
// Rendering a whole genome (Mbp) into the DOM would freeze the browser, so above
// this length grep switches to a windowed view: each match with bounded flanks.
const GREP_INLINE_LIMIT = 50_000
const GREP_FLANK = 40

function distClass(d: number) {
  return d === 0 ? 'hl-exact' : d === 1 ? 'hl-1' : 'hl-n'
}

function renderGrep(text: string, matches: MatchResult[]): React.ReactNode[] {
  if (!matches.length) return [<span key="all">{text}</span>]
  const sorted = [...matches].sort((a, b) => a.pos - b.pos)

  // Windowed view for genome-scale targets: one row of context per match.
  if (text.length > GREP_INLINE_LIMIT) {
    return sorted.map((m, i) => {
      const from = Math.max(0, m.pos - GREP_FLANK)
      const to = Math.min(text.length, m.end + GREP_FLANK)
      return (
        <div key={`win-${m.pos}-${i}`} className="grep-window">
          <span className="grep-window-pos">pos {m.pos}–{m.end}</span>
          <span className="grep-window-seq">
            {from > 0 && <span className="grep-ellipsis">…</span>}
            <span>{text.slice(from, m.pos)}</span>
            <span className={distClass(m.distance)} title={`dist=${m.distance} cigar=${m.cigar}`}>{text.slice(m.pos, m.end)}</span>
            <span>{text.slice(m.end, to)}</span>
            {to < text.length && <span className="grep-ellipsis">…</span>}
          </span>
        </div>
      )
    })
  }

  const nodes: React.ReactNode[] = []
  let cursor = 0
  for (const m of sorted) {
    if (m.pos > cursor) nodes.push(<span key={`pre-${m.pos}`}>{text.slice(cursor, m.pos)}</span>)
    nodes.push(<span key={`m-${m.pos}`} className={distClass(m.distance)} title={`dist=${m.distance} cigar=${m.cigar}`}>{text.slice(m.pos, m.end)}</span>)
    cursor = m.end
  }
  if (cursor < text.length) nodes.push(<span key="tail">{text.slice(cursor)}</span>)
  return nodes
}

import React from 'react'

function SassyIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none" width="32" height="32">
      <path d="M28 4C14 4 14 14 16 16C18 18 18 28 4 28" stroke="#06b6d4" strokeWidth="3" strokeLinecap="round"/>
      <path d="M4 4C18 4 18 14 16 16C14 18 14 28 28 28" stroke="#0d9488" strokeWidth="3" strokeLinecap="round"/>
      <circle cx="16" cy="16" r="4.5" fill="#0d9488"/>
      <circle cx="16" cy="16" r="2" fill="white"/>
    </svg>
  )
}

// Consumed once at mount: a genome handed over from the Reference Genomes page
// seeds the reference target, exactly as if it had been fetched in-place.
// Read lazily in useState initialisers so it never triggers an effect re-render.
function takeInitialGenome() {
  const handoff = takeGenomeHandoff()
  if (!handoff) return null
  const seq = cleanDna(parseFastaFirst(handoff.fasta))
  return { seq, filename: handoff.filename }
}

function ToolPage() {
  // Read the handoff exactly once for this mount.
  const [initialGenome] = useState(takeInitialGenome)
  const [mode, setMode] = useState<Mode>('search')
  const [pattern, setPattern] = useState('')
  const [text, setText] = useState('')
  // The active reference genome (fetched, never rendered in a textarea). When
  // set, it is the effective search target; otherwise the upload/paste text is.
  const [refSeq, setRefSeq] = useState<string | null>(initialGenome?.seq ?? null)
  const [refLabel, setRefLabel] = useState<string | null>(
    initialGenome ? `${initialGenome.filename} — ${(initialGenome.seq.length / 1e6).toFixed(2)} Mbp` : null,
  )
  const [targetSource, setTargetSource] = useState<TargetSource>('reference')
  const [fasta, setFasta] = useState('')          // for filter mode
  const [pam, setPam] = useState('NGG')           // for CRISPR mode
  const [k, setK] = useState(1)
  const [strand, setStrand] = useState<'fwd' | 'rc'>('fwd')
  const [results, setResults] = useState<MatchResult[]>([])
  const [filterResults, setFilterResults] = useState<{ id: string; seq: string; matches: number }[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [searchTime, setSearchTime] = useState<number | null>(null)
  // The cleaned target actually searched, captured so grep can highlight it
  // even when the source was a fetched reference genome (never in `text`).
  const [grepTarget, setGrepTarget] = useState('')
  // `key` counters force the FileUpload to remount after each read. This resets the
  // underlying <input> value so re-selecting the *same* file fires a fresh change
  // event — without this, a second upload of an identical file is silently ignored.
  const [patternUploadKey, setPatternUploadKey] = useState(0)
  const [textUploadKey, setTextUploadKey] = useState(0)
  const [logs, setLogs] = useState<string[]>(
    initialGenome ? [`[genome] loaded "${initialGenome.filename}" from Reference Genomes`] : [],
  )

  const addLog = useCallback((msg: string) => {
    const ts = new Date().toISOString().slice(11, 23)
    setLogs((prev) => [...prev, `[${ts}] ${msg}`])
  }, [])

  const handlePatternFiles = useCallback((files: File[]) => {
    const file = files[0]
    if (!file) return
    addLog(`[upload] pattern file "${file.name}" (${file.size} bytes)`)
    readFileText(file)
      .then((c) => {
        setPattern(file.name.match(/\.(fasta|fa|fna)$/i) ? parseFastaFirst(c) : c.trim())
        addLog(`[upload] pattern loaded from "${file.name}"`)
      })
      .catch((e) => { setError(`Could not read ${file.name}: ${e instanceof Error ? e.message : String(e)}`) })
      .finally(() => setPatternUploadKey((n) => n + 1))
  }, [addLog])

  const handleTextFiles = useCallback((files: File[]) => {
    const file = files[0]
    if (!file) return
    addLog(`[upload] target file "${file.name}" (${file.size} bytes)`)
    readFileText(file)
      .then((c) => {
        if (mode === 'filter') setFasta(c)
        else setText(file.name.match(/\.(fasta|fa|fna)$/i) ? parseFastaFirst(c) : c.trim())
        addLog(`[upload] target loaded from "${file.name}"`)
      })
      .catch((e) => { setError(`Could not read ${file.name}: ${e instanceof Error ? e.message : String(e)}`) })
      .finally(() => setTextUploadKey((n) => n + 1))
  }, [addLog, mode])

  // Reference genome fetched in-place by the selector. Already cleaned to DNA.
  const handleRefLoaded = useCallback((loaded: LoadedRef) => {
    setRefSeq(loaded.seq)
    setRefLabel(loaded.label)
    setError(null)
    setResults([]); setFilterResults([]); setSearchTime(null)
  }, [])

  const clearRef = useCallback(() => {
    setRefSeq(null)
    setRefLabel(null)
    addLog('[ref] cleared reference genome')
  }, [addLog])

  const [sampleLoading, setSampleLoading] = useState(false)

  const loadExample = useCallback(async () => {
    const ex = EXAMPLES[mode]
    setPattern(ex.pattern)
    if (mode === 'crispr') setPam(ex.pam ?? 'NGG')
    setK(ex.k)
    if (ex.strand) setStrand(ex.strand)
    setError(null)
    setResults([]); setFilterResults([]); setSearchTime(null)

    // Filter operates on a pasted multi-FASTA; it does not use a reference genome.
    if (mode === 'filter') {
      setFasta(ex.fasta ?? '')
      setTargetSource('upload')
      addLog(`[sample] loaded sample FASTA for "filter" mode (k=${ex.k})`)
      return
    }

    // Search / grep / crispr run against a real fetched genome (E. coli K-12),
    // exercising the same fetch path as the reference picker.
    setTargetSource('reference')
    setSampleLoading(true)
    addLog(`[sample] fetching real example genome ${SAMPLE_GENOME.name} (${SAMPLE_GENOME.accession})…`)
    try {
      const result = await fetchBacterialGenome(SAMPLE_GENOME)
      const seq = cleanDna(parseFastaFirst(result.fasta))
      if (!seq) throw new Error('Example genome contained no DNA bases')
      setRefSeq(seq)
      setRefLabel(`${SAMPLE_GENOME.name} — ${(seq.length / 1e6).toFixed(2)} Mbp`)
      addLog(`[sample] loaded ${SAMPLE_GENOME.name} (${seq.length.toLocaleString()} bp)`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(`Could not fetch example genome: ${msg}`)
      addLog(`[sample] error: ${msg}`)
    } finally {
      setSampleLoading(false)
    }
  }, [mode, addLog])

  const handleSearch = useCallback(async () => {
    setError(null); setResults([]); setFilterResults([]); setSearchTime(null)
    if (!pattern.trim()) { setError('Pattern is required'); return }

    // Effective target follows the chosen source: a fetched reference genome
    // (already cleaned to DNA), or the user's pasted/uploaded text. Filter mode
    // ignores this and reads the multi-FASTA paste directly.
    const effectiveTarget = targetSource === 'reference' ? (refSeq ?? '') : cleanDna(text)
    setGrepTarget(effectiveTarget)

    setLoading(true)
    addLog(`[${mode}] starting — pattern length ${pattern.trim().length}, k=${k}`)
    try {
      const wasm = await loadWasm(addLog)
      const t0 = performance.now()

      if (mode === 'filter') {
        const seqs = parseFasta(fasta)
        if (!seqs.length) { setError('Paste FASTA sequences in the target box'); setLoading(false); return }
        const cleanPat = cleanDna(pattern)
        addLog(`[filter] ${seqs.length} sequences, pattern "${cleanPat}", strand=${strand}`)
        const fn = (strand === 'rc' ? wasm['search_rc'] : wasm['search']) as (p: string, t: string, k: number) => MatchResult[]
        const res = seqs.map((s) => {
          const cleanSeq = cleanDna(s.seq)
          const matches = fn(cleanPat, cleanSeq, k)
          return { id: s.id, seq: s.seq, matches: matches.length }
        })
        setFilterResults(res)
        addLog(`[filter] done — ${res.filter(r => r.matches > 0).length}/${seqs.length} sequences matched`)
      } else if (mode === 'crispr') {
        const crisprPat = buildCrisprPattern(pattern, pam)
        if (crisprPat.length < 4) { setError('Guide + PAM pattern is too short'); setLoading(false); return }
        if (!effectiveTarget) { setError('Target sequence required'); setLoading(false); return }
        addLog(`[crispr] guide+PAM="${crisprPat}", text length=${effectiveTarget.length}`)
        const fn = wasm['search_iupac_rc'] as (p: string, t: string, k: number) => MatchResult[]
        const res = fn(crisprPat, effectiveTarget, k)
        setResults(res)
        addLog(`[crispr] done — ${res.length} target site${res.length !== 1 ? 's' : ''} found`)
      } else {
        const cleanPat = cleanDna(pattern)
        if (!cleanPat) { setError('Pattern must be valid DNA'); setLoading(false); return }
        if (!effectiveTarget) { setError('Target sequence required'); setLoading(false); return }
        addLog(`[${mode}] pattern="${cleanPat}", text length=${effectiveTarget.length}, strand=${strand}`)
        const fn = (strand === 'rc' ? wasm['search_rc'] : wasm['search']) as (p: string, t: string, k: number) => MatchResult[]
        const res = fn(cleanPat, effectiveTarget, k)
        setResults(res)
        addLog(`[${mode}] done — ${res.length} match${res.length !== 1 ? 'es' : ''} found`)
      }

      const elapsed = performance.now() - t0
      setSearchTime(elapsed)
      addLog(`[perf] elapsed ${elapsed.toFixed(3)} ms`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      addLog(`[error] ${msg}`)
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [pattern, text, refSeq, targetSource, fasta, pam, k, strand, mode, addLog])

  return (
      <main className="tool-main">
        <div className="hero">
          <h1 className="hero-title">Sassywasm</h1>
          <p className="hero-sub">
            <a href="https://github.com/RagnarGrootKoerkamp/sassy" target="_blank" rel="noopener">sassy</a>{' '}
            compiled to WebAssembly — approximate DNA string matching in the browser
          </p>
        </div>

        <div className="mode-bar">
          {MODES.map((m) => (
            <button key={m.value} type="button"
              className={`mode-btn${mode === m.value ? ' active' : ''}`}
              onClick={() => { setMode(m.value); setResults([]); setFilterResults([]); setSearchTime(null); setError(null) }}
            >
              <span className="mode-cli">{m.cli}</span>
              <span className="mode-label">{m.label}</span>
            </button>
          ))}
        </div>
        <p className="mode-desc">{MODES.find((m) => m.value === mode)?.description}</p>

        <div className="input-grid">
          <div className="card">
            <label className="field-label">
              {mode === 'crispr' ? 'Guide RNA (20 nt)' : 'Pattern (ACGT)'}
            </label>
            <textarea className="seq-input" value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              placeholder={mode === 'crispr' ? '20-nt guide sequence, no PAM' : 'e.g. ATCGATCG'}
              rows={3}
            />
            <FileUpload key={patternUploadKey} files={[]} onFilesChange={handlePatternFiles} multiple={false} accept=".fasta,.fa,.fna,.txt" label="Upload FASTA" />
          </div>

          <div className="card">
            {mode === 'filter' ? (
              <>
                <label className="field-label">Target sequences (FASTA — one per line)</label>
                <textarea className="seq-input fasta-input" value={fasta}
                  onChange={(e) => setFasta(e.target.value)}
                  placeholder={'>seq1\nACGT...\n>seq2\nACGT...'}
                  rows={6}
                />
                <FileUpload key={textUploadKey} files={[]} onFilesChange={handleTextFiles} multiple={false} accept=".fasta,.fa,.fna,.txt" label="Upload FASTA" />
              </>
            ) : (
              <>
                <label className="field-label">Target sequence</label>
                <div className="source-toggle">
                  <button type="button"
                    className={`mode-btn${targetSource === 'reference' ? ' active' : ''}`}
                    onClick={() => setTargetSource('reference')}
                  >Reference sequence</button>
                  <button type="button"
                    className={`mode-btn${targetSource === 'upload' ? ' active' : ''}`}
                    onClick={() => setTargetSource('upload')}
                  >Upload your own</button>
                </div>

                {targetSource === 'reference' ? (
                  <div className="ref-pane">
                    {refSeq !== null && (
                      <div className="ref-chip" data-testid="ref-chip">
                        <span className="ref-chip-label">{refLabel} loaded</span>
                        <button type="button" className="ref-chip-clear" onClick={clearRef} aria-label="Clear reference genome">× Clear</button>
                      </div>
                    )}
                    <RefGenomeSelector onLoaded={handleRefLoaded} onLog={addLog} />
                  </div>
                ) : (
                  <>
                    <textarea className="seq-input" value={text}
                      onChange={(e) => setText(e.target.value)}
                      placeholder="longer DNA sequence to search in"
                      rows={3}
                    />
                    <FileUpload key={textUploadKey} files={[]} onFilesChange={handleTextFiles} multiple={false} accept=".fasta,.fa,.fna,.txt" label="Upload FASTA" />
                  </>
                )}
              </>
            )}
          </div>
        </div>

        {mode === 'crispr' && (
          <div className="pam-row">
            <label className="field-label" htmlFor="pam">PAM sequence</label>
            <select id="pam" className="pam-select" value={pam} onChange={(e) => setPam(e.target.value)}>
              <option value="NGG">NGG (SpCas9)</option>
              <option value="NGA">NGA (SpCas9 variant)</option>
              <option value="NNGRRT">NNGRRT (SaCas9)</option>
              <option value="TTN">TTN (AsCas12a / 5′ PAM)</option>
            </select>
          </div>
        )}

        <div className="controls">
          <button type="button" className="btn-outline" onClick={loadExample} disabled={sampleLoading}>
            {sampleLoading ? 'Fetching example…' : `Load sample data (${MODES.find((m) => m.value === mode)?.label})`}
          </button>

          {mode !== 'crispr' && (
            <div className="strand-group">
              <label className="slider-label">Strand</label>
              <div className="radio-group">
                <label><input type="radio" value="fwd" checked={strand === 'fwd'} onChange={() => setStrand('fwd')} /> Forward</label>
                <label><input type="radio" value="rc" checked={strand === 'rc'} onChange={() => setStrand('rc')} /> Fwd + RC</label>
              </div>
            </div>
          )}

          <div className="slider-group">
            <label htmlFor="k-slider" className="slider-label">Max errors: {k}</label>
            <input id="k-slider" type="range" min={0} max={5} value={k} onChange={(e) => setK(Number(e.target.value))} />
          </div>

          <button type="button" className="btn-primary" onClick={handleSearch} disabled={loading}>
            {loading ? 'Searching…' : 'Search'}
          </button>
        </div>

        {error && <Alert variant="error">{error}</Alert>}

        {searchTime !== null && (
          <div className="results-summary">
            <span className="results-count">
              {mode === 'filter'
                ? `${filterResults.filter(r => r.matches > 0).length} / ${filterResults.length} sequences matched`
                : `${results.length} match${results.length !== 1 ? 'es' : ''} found`}
            </span>
            <span className="results-time">{searchTime.toFixed(2)} ms</span>
          </div>
        )}

        {/* SEARCH / CRISPR results */}
        {mode !== 'grep' && mode !== 'filter' && results.length > 0 && (
          <div className="match-list">
            {results.map((m, i) => (
              <div key={i} className="match-card">
                <div className="match-header">
                  <span className="match-index">#{i + 1}</span>
                  <span className={`dist-badge dist-${Math.min(m.distance, 3)}`}>
                    {m.distance === 0 ? 'Exact' : `${m.distance} error${m.distance !== 1 ? 's' : ''}`}
                  </span>
                  <span className="match-pos">pos {m.pos}–{m.end}</span>
                  {m.strand === 'rc' && <span className="strand-badge strand-rc">− rc</span>}
                  {mode === 'crispr' && (
                    <span className="pam-label">PAM: {m.matched_seq.slice(-(pam.length))}</span>
                  )}
                  <span className="match-cigar">{m.cigar}</span>
                </div>
                <div className="match-seq">
                  {mode === 'crispr'
                    ? <><span className="guide-seq">{m.matched_seq.slice(0, pattern.replace(/\s/g,'').length)}</span><span className="pam-seq">{m.matched_seq.slice(pattern.replace(/\s/g,'').length)}</span></>
                    : m.matched_seq}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* GREP results */}
        {mode === 'grep' && results.length > 0 && (
          <div className="card grep-output">
            <p className="grep-hint">Matches highlighted in sequence. Hover for details.</p>
            <div className="grep-seq">{renderGrep(grepTarget, results)}</div>
          </div>
        )}

        {/* FILTER results */}
        {mode === 'filter' && filterResults.length > 0 && (
          <div className="filter-results">
            <div className="filter-tabs">
              <span className="filter-label match-label">Matching ({filterResults.filter(r => r.matches > 0).length})</span>
              <span className="filter-label nomatch-label">No match ({filterResults.filter(r => r.matches === 0).length})</span>
            </div>
            {filterResults.map((r, i) => (
              <div key={i} className={`filter-row ${r.matches > 0 ? 'filter-match' : 'filter-nomatch'}`}>
                <span className="filter-id">{r.id}</span>
                <span className="filter-count">{r.matches > 0 ? `${r.matches} hit${r.matches !== 1 ? 's' : ''}` : 'no match'}</span>
                <span className="filter-seq">{r.seq.slice(0, 60)}{r.seq.length > 60 ? '…' : ''}</span>
              </div>
            ))}
          </div>
        )}
        <LogConsole logs={logs} title="sassy-wasm log" />
      </main>
  )
}

function About() {
  return (
    <main className="tool-main about-page">
      <div className="hero">
        <h1 className="hero-title">About Sassywasm</h1>
        <p className="hero-sub">Approximate DNA string matching in the browser</p>
      </div>

      <div className="card about-card">
        <p>
          Sassywasm runs{' '}
          <a href="https://github.com/RagnarGrootKoerkamp/sassy" target="_blank" rel="noopener">sassy</a>{' '}
          — a SIMD-accelerated approximate string matching library — compiled to WebAssembly.
          It finds all positions where a short DNA pattern matches a longer target sequence
          with at most <em>k</em> edit operations (substitutions, insertions, deletions).
        </p>
        <p>
          Everything runs locally in your browser using WebAssembly SIMD. No sequence data is
          ever uploaded to a server.
        </p>

        <h2 className="about-h2">Modes</h2>
        <ul className="about-list">
          <li><strong>Search</strong> — find all approximate matches and report positions, distances and alignment.</li>
          <li><strong>Grep</strong> — show matches highlighted in sequence context for visual inspection.</li>
          <li><strong>Filter</strong> — given a FASTA file, return only the sequences that match the pattern.</li>
          <li><strong>CRISPR</strong> — find guide RNA target sites with a PAM sequence on both strands.</li>
        </ul>

        <h2 className="about-h2">Reference Genomes</h2>
        <p>
          The <strong>Reference Genomes</strong> page fetches sequences directly in the browser —
          complete bacterial chromosomes from the EBI European Nucleotide Archive, and regions of
          human chromosomes (GRCh38) from Ensembl. Downloaded sequences can be saved as FASTA or
          loaded straight into the search target. As with everything else, the fetch happens
          client-side; no data passes through a Sassywasm server.
        </p>

        <h2 className="about-h2">Links</h2>
        <ul className="about-list">
          <li><a href="https://github.com/happykhan/Sassywasm" target="_blank" rel="noopener">Sassywasm source</a></li>
          <li><a href="https://github.com/RagnarGrootKoerkamp/sassy" target="_blank" rel="noopener">sassy (upstream library)</a></li>
        </ul>

        <p className="about-version">Version {APP_VERSION}</p>
      </div>
    </main>
  )
}

export default function App() {
  return (
    <AppShell
      appName="Sassywasm"
      version={APP_VERSION}
      githubUrl="https://github.com/happykhan/Sassywasm"
      icon={<SassyIcon />}
      actions={<Link className="nav-action" to="/genomes">Reference Genomes</Link>}
      mobileActions={<Link className="nav-action" to="/genomes">Reference Genomes</Link>}
    >
      <Routes>
        <Route path="/" element={<ToolPage />} />
        <Route path="/genomes" element={<GenomesPage />} />
        <Route path="/about" element={<About />} />
        <Route path="*" element={<ToolPage />} />
      </Routes>
    </AppShell>
  )
}
