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
}

const EXAMPLE = {
  pattern: 'ATCGATCGATCGATCGATCG',
  text: 'TTTTTTTTTTTTTATCGATCGATCGATCGATCGAAAAAAAAAAAAAATCGATCGATCTATCGATCGAAAAAAAAATCGATCGATCGATCGATCG',
}

let wasmSearch: ((pattern: string, text: string, k: number) => MatchResult[]) | null = null
let wasmLoading = false
let wasmError: string | null = null

async function loadWasm(): Promise<void> {
  if (wasmSearch || wasmLoading) return
  wasmLoading = true
  try {
    const wasm = await import('sassy-wasm')
    await wasm.default()
    wasmSearch = wasm.search
  } catch (e) {
    wasmError = e instanceof Error ? e.message : String(e)
    throw e
  } finally {
    wasmLoading = false
  }
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

export default function App() {
  const [pattern, setPattern] = useState('')
  const [text, setText] = useState('')
  const [k, setK] = useState(1)
  const [results, setResults] = useState<MatchResult[]>([])
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

  const handleSearch = useCallback(async () => {
    setError(null)
    setResults([])
    setSearchTime(null)
    if (!pattern.trim()) { setError('Pattern is required'); return }
    if (!text.trim()) { setError('Target text is required'); return }

    setLoading(true)
    try {
      await loadWasm()
      if (wasmError) { setError(`Failed to load WASM: ${wasmError}`); return }
      if (!wasmSearch) { setError('WASM module not available'); return }

      const cleanPattern = pattern.trim().toUpperCase().replace(/[^ACGT]/g, '')
      const cleanText = text.trim().toUpperCase().replace(/[^ACGT]/g, '')

      if (!cleanPattern.length) { setError('Pattern must contain valid DNA characters (ACGT)'); return }
      if (!cleanText.length) { setError('Target must contain valid DNA characters (ACGT)'); return }

      const t0 = performance.now()
      const matches = wasmSearch(cleanPattern, cleanText, k)
      setSearchTime(performance.now() - t0)
      setResults(matches)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [pattern, text, k])

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

        <div className="input-grid">
          <div className="card">
            <label className="field-label">Pattern (short DNA sequence)</label>
            <textarea
              className="seq-input"
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              placeholder="e.g. ATCGATCG"
              rows={3}
            />
            <FileUpload
              files={patternFiles}
              onFilesChange={handlePatternFiles}
              accept=".fasta,.fa,.fna,.txt"
              label="or upload FASTA"
            />
          </div>

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
        </div>

        <div className="controls">
          <button
            type="button"
            className="btn-outline"
            onClick={() => { setPattern(EXAMPLE.pattern); setText(EXAMPLE.text) }}
          >
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
            Found {results.length} match{results.length !== 1 ? 'es' : ''} in{' '}
            {searchTime.toFixed(2)} ms
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
