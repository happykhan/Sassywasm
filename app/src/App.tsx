import { useState, useRef, useCallback } from 'react'
import './App.css'

interface MatchResult {
  pos: number
  end: number
  distance: number
  matched_seq: string
  cigar: string
}

// WASM module state
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
      if (inSequence) break // only take the first sequence
      inSequence = true
      continue
    }
    if (inSequence && trimmed.length > 0) {
      seqLines.push(trimmed)
    }
  }

  return seqLines.join('')
}

function App() {
  const [pattern, setPattern] = useState('')
  const [text, setText] = useState('')
  const [k, setK] = useState(1)
  const [results, setResults] = useState<MatchResult[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [searchTime, setSearchTime] = useState<number | null>(null)
  const patternFileRef = useRef<HTMLInputElement>(null)
  const textFileRef = useRef<HTMLInputElement>(null)

  const handleFileUpload = useCallback(
    (setter: (val: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = (ev) => {
        const content = ev.target?.result as string
        if (file.name.endsWith('.fasta') || file.name.endsWith('.fa') || file.name.endsWith('.fna')) {
          setter(parseFasta(content))
        } else {
          // Plain text file — use as-is
          setter(content.trim())
        }
      }
      reader.readAsText(file)
    },
    []
  )

  const handleSearch = useCallback(async () => {
    setError(null)
    setResults([])
    setSearchTime(null)

    if (!pattern.trim()) {
      setError('Pattern is required')
      return
    }
    if (!text.trim()) {
      setError('Target text is required')
      return
    }

    setLoading(true)
    try {
      await loadWasm()
      if (wasmError) {
        setError(`Failed to load WASM: ${wasmError}`)
        return
      }
      if (!wasmSearch) {
        setError('WASM module not available')
        return
      }

      const cleanPattern = pattern.trim().toUpperCase().replace(/[^ACGT]/g, '')
      const cleanText = text.trim().toUpperCase().replace(/[^ACGT]/g, '')

      if (cleanPattern.length === 0) {
        setError('Pattern must contain valid DNA characters (ACGT)')
        return
      }
      if (cleanText.length === 0) {
        setError('Target must contain valid DNA characters (ACGT)')
        return
      }

      const t0 = performance.now()
      const matches = wasmSearch(cleanPattern, cleanText, k)
      const t1 = performance.now()
      setSearchTime(t1 - t0)
      setResults(matches)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [pattern, text, k])

  return (
    <div className="container">
      <header>
        <h1>Sassywasm</h1>
        <p className="subtitle">
          SIMD-accelerated approximate DNA string matching in the browser
        </p>
        <p className="credit">
          Powered by <a href="https://github.com/RagnarGrootKoerkamp/sassy" target="_blank" rel="noopener">sassy</a> compiled to WebAssembly
        </p>
      </header>

      <main>
        <div className="input-grid">
          <div className="input-section">
            <label htmlFor="pattern">Pattern (short DNA sequence)</label>
            <textarea
              id="pattern"
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              placeholder="e.g. ATCGATCG"
              rows={3}
            />
            <div className="file-upload">
              <button type="button" onClick={() => patternFileRef.current?.click()}>
                Upload FASTA
              </button>
              <input
                ref={patternFileRef}
                type="file"
                accept=".fasta,.fa,.fna,.txt"
                onChange={handleFileUpload(setPattern)}
                hidden
              />
            </div>
          </div>

          <div className="input-section">
            <label htmlFor="text">Target (longer DNA sequence)</label>
            <textarea
              id="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="e.g. AAAAATCAATCGGGGG"
              rows={3}
            />
            <div className="file-upload">
              <button type="button" onClick={() => textFileRef.current?.click()}>
                Upload FASTA
              </button>
              <input
                ref={textFileRef}
                type="file"
                accept=".fasta,.fa,.fna,.txt"
                onChange={handleFileUpload(setText)}
                hidden
              />
            </div>
          </div>
        </div>

        <div className="controls">
          <div className="slider-group">
            <label htmlFor="k-slider">Max errors: {k}</label>
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
            className="search-btn"
            onClick={handleSearch}
            disabled={loading}
          >
            {loading ? 'Searching...' : 'Search'}
          </button>
        </div>

        {error && <div className="error">{error}</div>}

        {searchTime !== null && (
          <p className="timing">
            Found {results.length} match{results.length !== 1 ? 'es' : ''} in{' '}
            {searchTime.toFixed(2)} ms
          </p>
        )}

        {results.length > 0 && (
          <div className="results">
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
                    <td className="cigar">{m.cigar}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>

      <footer>
        <p>
          <a href="https://github.com/happykhan/Sassywasm" target="_blank" rel="noopener">Source on GitHub</a>
        </p>
      </footer>
    </div>
  )
}

export default App
