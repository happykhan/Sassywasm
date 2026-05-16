import { useState, useCallback, useEffect } from 'react'
import { AppShell, FileUpload, Alert } from '@genomicx/ui'
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

type SearchMode = 'search' | 'search_rc' | 'search_iupac' | 'count'

const MODES: { value: SearchMode; label: string; description: string }[] = [
  { value: 'search',       label: 'Forward (DNA)',         description: 'Search forward strand only. Pattern must be ACGT.' },
  { value: 'search_rc',    label: 'Forward + Rev-comp',    description: 'Search both strands. Useful for sequencing data where orientation is unknown.' },
  { value: 'search_iupac', label: 'IUPAC (ambiguous)',     description: 'Pattern may contain IUPAC ambiguity codes (R, Y, N, etc.).' },
  { value: 'count',        label: 'Count only',            description: 'Fast: returns match count with no position or CIGAR tracking.' },
]

const EXAMPLES: Record<SearchMode, { pattern: string; text: string; label: string }> = {
  search: {
    label: 'Forward DNA search (3 approximate matches)',
    pattern: 'ATCGATCGATCGATCGATCG',
    text:    'TTTTTTTTTTTTTATCGATCGATCGATCGATCGAAAAAAAAAAAAAATCGATCGATCTATCGATCGAAAAAAAAATCGATCGATCGATCGATCG',
  },
  search_rc: {
    label: 'Forward + reverse complement (matches on both strands)',
    pattern: 'ATCG',
    text:    'CCCATCACCC',
  },
  search_iupac: {
    label: 'IUPAC pattern (R = A or G)',
    pattern: 'ATCGRAATCG',
    text:    'TTTATCGAAATCGTTTTTTATCGGAATCG',
  },
  count: {
    label: 'Count matches only',
    pattern: 'ATCGATCG',
    text:    'ATCGATCGATCGATCGTTTATCGATCG',
  },
}

let wasmModule: Record<string, unknown> | null = null

async function loadWasm(): Promise<Record<string, unknown>> {
  if (wasmModule) return wasmModule
  const wasm = await import('sassy-wasm')
  await (wasm.default as () => Promise<void>)()
  wasmModule = wasm as unknown as Record<string, unknown>
  return wasmModule
}

function parseFasta(content: string): string {
  const lines = content.split('\n')
  const seqLines: string[] = []
  let inSequence = false
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('>')) {
      if (inSequence) break
      inSequence = true
      continue
    }
    if (inSequence && trimmed.length > 0) seqLines.push(trimmed)
  }
  return seqLines.join('')
}

function readFileText(file: File): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = (ev) => resolve(ev.target?.result as string)
    reader.readAsText(file)
  })
}

function cleanDna(seq: string): string {
  return seq.trim().toUpperCase().replace(/[^ACGT]/g, '')
}

function cleanIupac(seq: string): string {
  return seq.trim().toUpperCase().replace(/[^ACGTRYMKSWHBDVN]/g, '')
}

export default function App() {
  const [pattern, setPattern] = useState('')
  const [text, setText] = useState('')
  const [k, setK] = useState(1)
  const [mode, setMode] = useState<SearchMode>('search')
  const [results, setResults] = useState<MatchResult[]>([])
  const [matchCount, setMatchCount] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [searchTime, setSearchTime] = useState<number | null>(null)
  const [patternFiles, setPatternFiles] = useState<File[]>([])
  const [textFiles, setTextFiles] = useState<File[]>([])

  useEffect(() => {
    const file = patternFiles[0]
    if (!file) return
    readFileText(file).then((content) =>
      setPattern(file.name.match(/\.(fasta|fa|fna)$/i) ? parseFasta(content) : content.trim())
    )
  }, [patternFiles])

  useEffect(() => {
    const file = textFiles[0]
    if (!file) return
    readFileText(file).then((content) =>
      setText(file.name.match(/\.(fasta|fa|fna)$/i) ? parseFasta(content) : content.trim())
    )
  }, [textFiles])

  const handlePatternFiles = useCallback((files: File[]) => setPatternFiles(files), [])
  const handleTextFiles = useCallback((files: File[]) => setTextFiles(files), [])

  const loadExample = useCallback(() => {
    const ex = EXAMPLES[mode]
    setPattern(ex.pattern)
    setText(ex.text)
  }, [mode])

  const handleSearch = useCallback(async () => {
    setError(null)
    setResults([])
    setMatchCount(null)
    setSearchTime(null)

    if (!pattern.trim()) { setError('Pattern is required'); return }
    if (!text.trim()) { setError('Target sequence is required'); return }

    setLoading(true)
    try {
      const wasm = await loadWasm()
      const cleanPattern = mode === 'search_iupac' ? cleanIupac(pattern) : cleanDna(pattern)
      const cleanText = cleanDna(text)

      if (!cleanPattern.length) { setError('Pattern contains no valid characters for the selected mode'); return }
      if (!cleanText.length) { setError('Target must contain valid DNA characters (ACGT)'); return }

      const t0 = performance.now()

      if (mode === 'count') {
        const fn = wasm['count'] as (p: string, t: string, k: number) => number
        const n = fn(cleanPattern, cleanText, k)
        setMatchCount(n)
      } else {
        const fn = wasm[mode] as (p: string, t: string, k: number) => MatchResult[]
        const matches = fn(cleanPattern, cleanText, k)
        setResults(matches)
      }

      setSearchTime(performance.now() - t0)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [pattern, text, k, mode])

  const showStrand = mode === 'search_rc'

  return (
    <AppShell
      appName="Sassywasm"
      version={APP_VERSION}
      githubUrl="https://github.com/happykhan/Sassywasm"
    >
      <main className="tool-main">
        <div className="hero">
          <h1 className="hero-title">Sassywasm</h1>
          <p className="hero-sub">
            SIMD-accelerated approximate DNA string matching in the browser, powered by{' '}
            <a href="https://github.com/RagnarGrootKoerkamp/sassy" target="_blank" rel="noopener">sassy</a>{' '}
            compiled to WebAssembly
          </p>
        </div>

        <div className="mode-bar">
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              className={`mode-btn${mode === m.value ? ' active' : ''}`}
              onClick={() => { setMode(m.value); setResults([]); setMatchCount(null); setSearchTime(null) }}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="mode-desc">{MODES.find((m) => m.value === mode)?.description}</p>

        <div className="input-grid">
          <div className="card">
            <label className="field-label">Pattern {mode === 'search_iupac' ? '(IUPAC)' : '(ACGT)'}</label>
            <textarea
              className="seq-input"
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              placeholder={mode === 'search_iupac' ? 'e.g. ATCGRAATCG' : 'e.g. ATCGATCG'}
              rows={3}
            />
            <FileUpload
              files={patternFiles}
              onFilesChange={handlePatternFiles}
              accept=".fasta,.fa,.fna,.txt"
              label="or upload FASTA"
            />
          </div>

          {mode !== 'count' || true ? (
            <div className="card">
              <label className="field-label">Target (longer DNA sequence)</label>
              <textarea
                className="seq-input"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="e.g. AAAAATCAATCGGGGG"
                rows={3}
              />
              <FileUpload
                files={textFiles}
                onFilesChange={handleTextFiles}
                accept=".fasta,.fa,.fna,.txt"
                label="or upload FASTA"
              />
            </div>
          ) : null}
        </div>

        <div className="controls">
          <button type="button" className="btn-outline" onClick={loadExample}>
            Load example
          </button>
          <div className="slider-group">
            <label htmlFor="k-slider" className="slider-label">Max errors: {k}</label>
            <input
              id="k-slider"
              type="range"
              min={0}
              max={5}
              value={k}
              onChange={(e) => setK(Number(e.target.value))}
            />
          </div>
          <button
            type="button"
            className="btn-primary"
            onClick={handleSearch}
            disabled={loading}
          >
            {loading ? 'Searching…' : 'Search'}
          </button>
        </div>

        {error && <Alert variant="error">{error}</Alert>}

        {searchTime !== null && (
          <p className="timing">
            {mode === 'count'
              ? `${matchCount} match${matchCount !== 1 ? 'es' : ''} in ${searchTime.toFixed(2)} ms`
              : `Found ${results.length} match${results.length !== 1 ? 'es' : ''} in ${searchTime.toFixed(2)} ms`}
          </p>
        )}

        {results.length > 0 && (
          <div className="results card">
            <table>
              <thead>
                <tr>
                  <th>Position</th>
                  <th>End</th>
                  <th>Distance</th>
                  {showStrand && <th>Strand</th>}
                  <th>Matched Sequence</th>
                  <th>CIGAR</th>
                </tr>
              </thead>
              <tbody>
                {results.map((m, i) => (
                  <tr key={i}>
                    <td>{m.pos}</td>
                    <td>{m.end}</td>
                    <td>{m.distance}</td>
                    {showStrand && (
                      <td>
                        <span className={`strand-badge strand-${m.strand}`}>
                          {m.strand === 'fwd' ? '+ fwd' : '− rc'}
                        </span>
                      </td>
                    )}
                    <td className="seq">{m.matched_seq}</td>
                    <td className="seq">{m.cigar}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </AppShell>
  )
}
