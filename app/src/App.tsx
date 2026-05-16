import { useState, useCallback, useEffect } from 'react'
import { AppShell, FileUpload, Alert, LogConsole } from '@genomicx/ui'
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

const MODES: { value: Mode; label: string; cli: string; description: string }[] = [
  { value: 'search',  label: 'Search',  cli: 'sassy search',  description: 'Find all approximate matches and report positions, distances, and alignment.' },
  { value: 'grep',    label: 'Grep',    cli: 'sassy grep',    description: 'Show matches highlighted in sequence context — useful for visual inspection.' },
  { value: 'filter',  label: 'Filter',  cli: 'sassy filter',  description: 'Given multiple sequences (FASTA), return only those that match (or don\'t match) the pattern.' },
  { value: 'crispr',  label: 'CRISPR', cli: 'sassy crispr',  description: 'Find CRISPR guide RNA target sites with PAM sequence on both strands.' },
]

const EXAMPLES: Record<Mode, { pattern: string; text: string; fasta?: string; pam?: string }> = {
  search: {
    pattern: 'ATCGATCGATCGATCGATCG',
    text:    'TTTTTTTTTTTTTATCGATCGATCGATCGATCGAAAAAAAAAAAAAATCGATCGATCTATCGATCGAAAAAAAAATCGATCGATCGATCGATCG',
  },
  grep: {
    pattern: 'ATCGATCG',
    text:    'GGGGGGATCGATCGTTTTTTATCAATCGCCCCCCATCGATCGAAAAAA',
  },
  filter: {
    pattern: 'ATCGATCG',
    text:    '',
    fasta:   '>seq1 (matches)\nATCGATCGATCGATCG\n>seq2 (no match)\nGGGGGGGGGGGGGGGG\n>seq3 (1 error)\nATCGATTGATCGATCG\n>seq4 (no match)\nCCCCCCCCCCCCCCCC',
  },
  crispr: {
    pattern: 'ATCGATCGATCGATCGATCG',
    text:    'TTTATCGATCGATCGATCGATCGGGGCCCCCCGATCGATCGATCGATCGATCGCCGAATCGATCGATCGATCGATCGAGG',
    pam:     'NGG',
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
  addLog('[wasm] ready')
  return wasmModule
}

function parseFasta(content: string): { id: string; seq: string }[] {
  const seqs: { id: string; seq: string }[] = []
  let current: { id: string; seq: string } | null = null
  for (const line of content.split('\n')) {
    const t = line.trim()
    if (t.startsWith('>')) {
      if (current) seqs.push(current)
      current = { id: t.slice(1), seq: '' }
    } else if (current && t) {
      current.seq += t
    }
  }
  if (current) seqs.push(current)
  return seqs
}

function parseFastaFirst(content: string): string {
  const seqs = parseFasta(content)
  return seqs[0]?.seq ?? content.trim()
}

function readFileText(file: File): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = (ev) => resolve(ev.target?.result as string)
    reader.readAsText(file)
  })
}

function cleanDna(s: string) { return s.trim().toUpperCase().replace(/[^ACGT]/g, '') }
function cleanIupac(s: string) { return s.trim().toUpperCase().replace(/[^ACGTRYMKSWHBDVN]/g, '') }

// Build IUPAC pattern: guide + PAM (e.g. NGG → '[ACGT]GG' in IUPAC = NGG)
function buildCrisprPattern(guide: string, pam: string): string {
  return cleanIupac(guide + pam)
}

// Highlight matches in the target sequence
function renderGrep(text: string, matches: MatchResult[]): React.ReactNode[] {
  if (!matches.length) return [<span key="all">{text}</span>]
  const sorted = [...matches].sort((a, b) => a.pos - b.pos)
  const nodes: React.ReactNode[] = []
  let cursor = 0
  for (const m of sorted) {
    if (m.pos > cursor) nodes.push(<span key={`pre-${m.pos}`}>{text.slice(cursor, m.pos)}</span>)
    const cls = m.distance === 0 ? 'hl-exact' : m.distance === 1 ? 'hl-1' : 'hl-n'
    nodes.push(<span key={`m-${m.pos}`} className={cls} title={`dist=${m.distance} cigar=${m.cigar}`}>{text.slice(m.pos, m.end)}</span>)
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

export default function App() {
  const [mode, setMode] = useState<Mode>('search')
  const [pattern, setPattern] = useState('')
  const [text, setText] = useState('')
  const [fasta, setFasta] = useState('')          // for filter mode
  const [pam, setPam] = useState('NGG')           // for CRISPR mode
  const [k, setK] = useState(1)
  const [strand, setStrand] = useState<'fwd' | 'rc'>('fwd')
  const [results, setResults] = useState<MatchResult[]>([])
  const [filterResults, setFilterResults] = useState<{ id: string; seq: string; matches: number }[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [searchTime, setSearchTime] = useState<number | null>(null)
  const [patternFiles, setPatternFiles] = useState<File[]>([])
  const [textFiles, setTextFiles] = useState<File[]>([])
  const [logs, setLogs] = useState<string[]>([])

  const addLog = useCallback((msg: string) => {
    const ts = new Date().toISOString().slice(11, 23)
    setLogs((prev) => [...prev, `[${ts}] ${msg}`])
  }, [])

  useEffect(() => {
    const file = patternFiles[0]; if (!file) return
    readFileText(file).then((c) => setPattern(file.name.match(/\.(fasta|fa|fna)$/i) ? parseFastaFirst(c) : c.trim()))
  }, [patternFiles])

  useEffect(() => {
    const file = textFiles[0]; if (!file) return
    readFileText(file).then((c) => {
      if (mode === 'filter') setFasta(c)
      else setText(file.name.match(/\.(fasta|fa|fna)$/i) ? parseFastaFirst(c) : c.trim())
    })
  }, [textFiles, mode])

  const loadExample = useCallback(() => {
    const ex = EXAMPLES[mode]
    setPattern(ex.pattern)
    if (mode === 'filter') setFasta(ex.fasta ?? '')
    else setText(ex.text)
    if (mode === 'crispr') setPam(ex.pam ?? 'NGG')
    setResults([]); setFilterResults([]); setSearchTime(null)
  }, [mode])

  const handleSearch = useCallback(async () => {
    setError(null); setResults([]); setFilterResults([]); setSearchTime(null)
    if (!pattern.trim()) { setError('Pattern is required'); return }

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
        const cleanText = cleanDna(text)
        if (!cleanText) { setError('Target sequence required'); setLoading(false); return }
        addLog(`[crispr] guide+PAM="${crisprPat}", text length=${cleanText.length}`)
        const fn = wasm['search_rc'] as (p: string, t: string, k: number) => MatchResult[]
        const res = fn(crisprPat, cleanText, k)
        setResults(res)
        addLog(`[crispr] done — ${res.length} target site${res.length !== 1 ? 's' : ''} found`)
      } else {
        const cleanPat = cleanDna(pattern)
        const cleanText = cleanDna(text)
        if (!cleanPat) { setError('Pattern must be valid DNA'); setLoading(false); return }
        if (!cleanText) { setError('Target sequence required'); setLoading(false); return }
        addLog(`[${mode}] pattern="${cleanPat}", text length=${cleanText.length}, strand=${strand}`)
        const fn = (strand === 'rc' ? wasm['search_rc'] : wasm['search']) as (p: string, t: string, k: number) => MatchResult[]
        const res = fn(cleanPat, cleanText, k)
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
  }, [pattern, text, fasta, pam, k, strand, mode, addLog])

  return (
    <AppShell
      appName="Sassywasm"
      version={APP_VERSION}
      githubUrl="https://github.com/happykhan/Sassywasm"
      icon={<SassyIcon />}
    >
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
            <FileUpload files={patternFiles} onFilesChange={setPatternFiles} accept=".fasta,.fa,.fna,.txt" label="Upload FASTA" />
          </div>

          <div className="card">
            <label className="field-label">
              {mode === 'filter' ? 'Target sequences (FASTA — one per line)' : 'Target sequence'}
            </label>
            {mode === 'filter' ? (
              <textarea className="seq-input fasta-input" value={fasta}
                onChange={(e) => setFasta(e.target.value)}
                placeholder={'>seq1\nACGT...\n>seq2\nACGT...'}
                rows={6}
              />
            ) : (
              <textarea className="seq-input" value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="longer DNA sequence to search in"
                rows={3}
              />
            )}
            <FileUpload files={textFiles} onFilesChange={setTextFiles} accept=".fasta,.fa,.fna,.txt" label="Upload FASTA" />
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
          <button type="button" className="btn-outline" onClick={loadExample}>Load example</button>

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
            <div className="grep-seq">{renderGrep(cleanDna(text), results)}</div>
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
    </AppShell>
  )
}
