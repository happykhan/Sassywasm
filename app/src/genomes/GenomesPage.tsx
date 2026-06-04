import { useCallback, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, ProgressBar, downloadText } from '@genomicx/ui'
import {
  BACTERIA,
  HUMAN_CHROMOSOMES,
  DEFAULT_HUMAN_WINDOW,
  type BacterialGenome,
  type HumanChromosome,
} from './catalog'
import {
  fetchBacterialGenome,
  fetchHumanRegion,
  type FetchProgress,
  type FetchedGenome,
} from './fetchGenome'
import { setGenomeHandoff } from './handoff'

type Busy = { id: string; progress: FetchProgress } | null

export function GenomesPage() {
  const navigate = useNavigate()
  const [busy, setBusy] = useState<Busy>(null)
  const [error, setError] = useState<string | null>(null)
  // Per-chromosome region controls (1-based start + window length in bp).
  const [humanStart, setHumanStart] = useState(1)
  const [humanWindow, setHumanWindow] = useState(DEFAULT_HUMAN_WINDOW)
  const [selectedChrom, setSelectedChrom] = useState<HumanChromosome>(HUMAN_CHROMOSOMES[0])
  const abortRef = useRef<AbortController | null>(null)

  const windowMb = useMemo(() => (humanWindow / 1e6).toFixed(2), [humanWindow])

  const run = useCallback(
    async (id: string, fetcher: (onProgress: (p: FetchProgress) => void, signal: AbortSignal) => Promise<FetchedGenome>) => {
      setError(null)
      const controller = new AbortController()
      abortRef.current = controller
      setBusy({ id, progress: { fraction: 0, loaded: 0, message: 'starting…' } })
      try {
        const result = await fetcher(
          (progress) => setBusy({ id, progress }),
          controller.signal,
        )
        return result
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') {
          setError('Download cancelled.')
        } else {
          setError(e instanceof Error ? e.message : String(e))
        }
        return null
      } finally {
        setBusy(null)
        abortRef.current = null
      }
    },
    [],
  )

  const loadIntoTool = useCallback(
    (result: FetchedGenome) => {
      setGenomeHandoff({ filename: result.filename, fasta: result.fasta })
      navigate('/')
    },
    [navigate],
  )

  const handleBacteria = useCallback(
    async (genome: BacterialGenome, mode: 'download' | 'use') => {
      const result = await run(genome.id, (onProgress, signal) =>
        fetchBacterialGenome(genome, onProgress, signal),
      )
      if (!result) return
      if (mode === 'download') downloadText(result.fasta, result.filename, 'text/x-fasta')
      else loadIntoTool(result)
    },
    [run, loadIntoTool],
  )

  const handleHuman = useCallback(
    async (mode: 'download' | 'use') => {
      const chrom = selectedChrom
      const result = await run(chrom.id, (onProgress, signal) =>
        fetchHumanRegion(chrom, humanStart, humanWindow, onProgress, signal),
      )
      if (!result) return
      if (mode === 'download') downloadText(result.fasta, result.filename, 'text/x-fasta')
      else loadIntoTool(result)
    },
    [run, loadIntoTool, selectedChrom, humanStart, humanWindow],
  )

  const cancel = useCallback(() => abortRef.current?.abort(), [])

  return (
    <main className="tool-main">
      <div className="hero">
        <h1 className="hero-title">Reference Genomes</h1>
        <p className="hero-sub">
          Fetch reference sequences straight into the browser — then download them or load
          them as the search target. Nothing is uploaded to a server.
        </p>
      </div>

      {error && <Alert variant="error">{error}</Alert>}

      {busy && (
        <div className="card genome-progress">
          <ProgressBar
            value={busy.progress.fraction === null ? 0 : Math.round(busy.progress.fraction * 100)}
            label={`Downloading ${busy.id} — ${busy.progress.message}`}
          />
          <button type="button" className="btn-outline" onClick={cancel}>Cancel</button>
        </div>
      )}

      <section className="genome-section">
        <h2 className="about-h2">Bacteria</h2>
        <p className="mode-desc">
          Complete reference chromosomes from the EBI European Nucleotide Archive
          (~2–6 Mbp each). Fetched in full.
        </p>
        <div className="genome-grid">
          {BACTERIA.map((g) => (
            <div key={g.id} className="card genome-card" data-genome={g.id}>
              <div className="genome-name"><em>{g.name}</em></div>
              <div className="genome-meta">
                {g.accession} · {(g.approxLength / 1e6).toFixed(2)} Mbp
              </div>
              <div className="genome-actions">
                <button
                  type="button"
                  className="btn-primary"
                  disabled={busy !== null}
                  onClick={() => handleBacteria(g, 'use')}
                >
                  Use in tool
                </button>
                <button
                  type="button"
                  className="btn-outline"
                  disabled={busy !== null}
                  onClick={() => handleBacteria(g, 'download')}
                >
                  Download
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="genome-section">
        <h2 className="about-h2">Human chromosomes (GRCh38)</h2>
        <p className="mode-desc">
          Full human chromosomes are hundreds of Mbp — too large to hold in the browser.
          Fetch a bounded region from Ensembl instead (chunked automatically at 10 Mbp per request).
        </p>
        <div className="card genome-human">
          <div className="genome-human-controls">
            <label className="field-label" htmlFor="chrom-select">Chromosome</label>
            <select
              id="chrom-select"
              className="pam-select"
              value={selectedChrom.id}
              onChange={(e) => {
                const next = HUMAN_CHROMOSOMES.find((c) => c.id === e.target.value)
                if (next) {
                  setSelectedChrom(next)
                  setHumanStart((s) => Math.min(s, next.length))
                }
              }}
            >
              {HUMAN_CHROMOSOMES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({(c.length / 1e6).toFixed(1)} Mbp)
                </option>
              ))}
            </select>

            <label className="field-label" htmlFor="human-start">Start (bp)</label>
            <input
              id="human-start"
              className="genome-num"
              type="number"
              min={1}
              max={selectedChrom.length}
              value={humanStart}
              onChange={(e) => setHumanStart(Math.max(1, Number(e.target.value) || 1))}
            />

            <label className="field-label" htmlFor="human-window">Window: {windowMb} Mbp</label>
            <input
              id="human-window"
              type="range"
              min={100_000}
              max={10_000_000}
              step={100_000}
              value={humanWindow}
              onChange={(e) => setHumanWindow(Number(e.target.value))}
            />
          </div>
          <div className="genome-actions">
            <button
              type="button"
              className="btn-primary"
              disabled={busy !== null}
              onClick={() => handleHuman('use')}
            >
              Use in tool
            </button>
            <button
              type="button"
              className="btn-outline"
              disabled={busy !== null}
              onClick={() => handleHuman('download')}
            >
              Download
            </button>
          </div>
        </div>
      </section>
    </main>
  )
}
