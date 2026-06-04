import { useCallback, useRef, useState } from 'react'
import { Alert, ProgressBar } from '@genomicx/ui'
import {
  BACTERIA,
  HUMAN_CHROMOSOMES,
  type BacterialGenome,
  type HumanChromosome,
} from './catalog'
import {
  fetchBacterialGenome,
  fetchWholeHumanChromosome,
  type FetchProgress,
  type FetchedGenome,
} from './fetchGenome'
import { cleanDna, parseFastaFirst } from './fasta'

export interface LoadedRef {
  /** Cleaned DNA sequence ready for the WASM matcher. */
  seq: string
  /** Human-readable label for the status chip, e.g. "E. coli K-12 — 4.64 Mbp". */
  label: string
}

interface Props {
  /** Called once a genome has been fetched and cleaned into WASM-ready DNA. */
  onLoaded: (loaded: LoadedRef) => void
  /** Free-text status line plumbed into the tool's log console. */
  onLog?: (msg: string) => void
}

type Busy = { id: string; progress: FetchProgress } | null

function mbp(bp: number): string {
  return `${(bp / 1e6).toFixed(2)} Mbp`
}

/**
 * Reference-genome picker for the tool page. Lets the user pick a curated
 * bacterial chromosome or a whole human chromosome, fetches it client-side,
 * and hands the cleaned sequence straight to the caller (never via a textarea).
 *
 * Human chromosomes are fetched in full — the Memory64 WASM build holds >4 GB
 * in Chrome, so no region/window controls are needed.
 */
export function RefGenomeSelector({ onLoaded, onLog }: Props) {
  const [busy, setBusy] = useState<Busy>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedChrom, setSelectedChrom] = useState<HumanChromosome>(HUMAN_CHROMOSOMES[0])
  const abortRef = useRef<AbortController | null>(null)

  const run = useCallback(
    async (
      id: string,
      label: string,
      fetcher: (onProgress: (p: FetchProgress) => void, signal: AbortSignal) => Promise<FetchedGenome>,
    ) => {
      setError(null)
      const controller = new AbortController()
      abortRef.current = controller
      setBusy({ id, progress: { fraction: 0, loaded: 0, message: 'starting…' } })
      onLog?.(`[ref] fetching ${label}…`)
      try {
        const result = await fetcher((progress) => setBusy({ id, progress }), controller.signal)
        const seq = cleanDna(parseFastaFirst(result.fasta))
        if (!seq) throw new Error('Fetched sequence contained no DNA bases')
        onLoaded({ seq, label: `${label} — ${mbp(seq.length)}` })
        onLog?.(`[ref] loaded ${label} (${seq.length.toLocaleString()} bp)`)
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') {
          setError('Fetch cancelled.')
          onLog?.('[ref] fetch cancelled')
        } else {
          const msg = e instanceof Error ? e.message : String(e)
          setError(msg)
          onLog?.(`[ref] error: ${msg}`)
        }
      } finally {
        setBusy(null)
        abortRef.current = null
      }
    },
    [onLoaded, onLog],
  )

  const handleBacteria = useCallback(
    (genome: BacterialGenome) =>
      run(genome.id, genome.name, (onProgress, signal) =>
        fetchBacterialGenome(genome, onProgress, signal),
      ),
    [run],
  )

  const handleHuman = useCallback(
    () =>
      run(selectedChrom.id, `Human ${selectedChrom.name} (GRCh38)`, (onProgress, signal) =>
        fetchWholeHumanChromosome(selectedChrom, onProgress, signal),
      ),
    [run, selectedChrom],
  )

  const cancel = useCallback(() => abortRef.current?.abort(), [])

  return (
    <div className="ref-selector">
      {error && <Alert variant="error">{error}</Alert>}

      {busy && (
        <div className="genome-progress" data-testid="ref-progress">
          <ProgressBar
            value={busy.progress.fraction === null ? 0 : Math.round(busy.progress.fraction * 100)}
            label={`Fetching — ${busy.progress.message}`}
          />
          <button type="button" className="btn-outline" onClick={cancel}>Cancel</button>
        </div>
      )}

      <div className="ref-block">
        <label className="field-label">Bacterial chromosome</label>
        <div className="ref-grid">
          {BACTERIA.map((g) => (
            <button
              key={g.id}
              type="button"
              className="ref-pick"
              data-genome={g.id}
              disabled={busy !== null}
              onClick={() => handleBacteria(g)}
            >
              <span className="ref-pick-name"><em>{g.name}</em></span>
              <span className="ref-pick-meta">{g.accession} · {mbp(g.approxLength)}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="ref-block">
        <label className="field-label" htmlFor="ref-chrom-select">Human chromosome (GRCh38)</label>
        <div className="ref-human-row">
          <select
            id="ref-chrom-select"
            className="pam-select"
            value={selectedChrom.id}
            disabled={busy !== null}
            onChange={(e) => {
              const next = HUMAN_CHROMOSOMES.find((c) => c.id === e.target.value)
              if (next) setSelectedChrom(next)
            }}
          >
            {HUMAN_CHROMOSOMES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({(c.length / 1e6).toFixed(1)} Mbp)
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn-primary"
            disabled={busy !== null}
            onClick={handleHuman}
          >
            Fetch whole chromosome
          </button>
        </div>
        <p className="ref-hint">
          Whole chromosome fetched in one go — no region selection. Large chromosomes may take a
          while and use significant memory.
        </p>
      </div>
    </div>
  )
}
