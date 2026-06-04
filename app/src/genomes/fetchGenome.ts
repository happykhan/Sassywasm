// Client-side reference-genome fetchers. Everything runs in the browser against
// CORS-enabled public endpoints (EBI ENA, Ensembl REST) — there is no server.

import {
  type BacterialGenome,
  type HumanChromosome,
  ENSEMBL_MAX_REGION,
} from './catalog'

export interface FetchProgress {
  /** 0–1, or null when total size is unknown. */
  fraction: number | null
  /** Bytes received so far. */
  loaded: number
  /** Free-text status line for the log/UI. */
  message: string
}

export interface FetchedGenome {
  /** Suggested filename, e.g. "U00096.3.fasta". */
  filename: string
  /** Raw FASTA text (header + sequence). */
  fasta: string
}

const ENA_BASE = 'https://www.ebi.ac.uk/ena/browser/api/fasta'
const ENSEMBL_BASE = 'https://rest.ensembl.org/sequence/region/human'

// Read a streaming response body, reporting progress as bytes arrive. Falls back
// gracefully to response.text() when streaming is unavailable (e.g. jsdom).
async function readStream(
  res: Response,
  onProgress?: (p: FetchProgress) => void,
): Promise<string> {
  const totalHeader = res.headers.get('content-length')
  const total = totalHeader ? Number(totalHeader) : null

  if (!res.body || typeof res.body.getReader !== 'function') {
    const text = await res.text()
    onProgress?.({ fraction: 1, loaded: text.length, message: 'received' })
    return text
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  const chunks: string[] = []
  let loaded = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    loaded += value.byteLength
    chunks.push(decoder.decode(value, { stream: true }))
    onProgress?.({
      fraction: total ? Math.min(loaded / total, 1) : null,
      loaded,
      message: total
        ? `${(loaded / 1e6).toFixed(1)} / ${(total / 1e6).toFixed(1)} MB`
        : `${(loaded / 1e6).toFixed(1)} MB`,
    })
  }
  chunks.push(decoder.decode())
  return chunks.join('')
}

/** Fetch a complete bacterial chromosome from EBI ENA as FASTA. */
export async function fetchBacterialGenome(
  genome: BacterialGenome,
  onProgress?: (p: FetchProgress) => void,
  signal?: AbortSignal,
): Promise<FetchedGenome> {
  onProgress?.({ fraction: 0, loaded: 0, message: `requesting ${genome.accession} from ENA` })
  const res = await fetch(`${ENA_BASE}/${encodeURIComponent(genome.accession)}`, { signal })
  if (!res.ok) {
    throw new Error(`ENA returned ${res.status} for ${genome.accession}`)
  }
  const fasta = await readStream(res, onProgress)
  if (!fasta.startsWith('>')) {
    throw new Error(`ENA response for ${genome.accession} was not FASTA`)
  }
  return { filename: `${genome.accession}.fasta`, fasta }
}

/**
 * Fetch a region of a human chromosome from Ensembl REST. A single Ensembl
 * request is capped at 10 Mbp, so larger windows are fetched in sequential
 * chunks and stitched into one FASTA record. `start` is 1-based inclusive.
 */
export async function fetchHumanRegion(
  chrom: HumanChromosome,
  start: number,
  length: number,
  onProgress?: (p: FetchProgress) => void,
  signal?: AbortSignal,
): Promise<FetchedGenome> {
  const safeStart = Math.max(1, Math.min(start, chrom.length))
  const end = Math.min(safeStart + length - 1, chrom.length)
  const totalBp = end - safeStart + 1
  if (totalBp <= 0) throw new Error('Requested region is empty')

  const seqParts: string[] = []
  let cursor = safeStart
  let fetched = 0
  while (cursor <= end) {
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
    const chunkEnd = Math.min(cursor + ENSEMBL_MAX_REGION - 1, end)
    const url = `${ENSEMBL_BASE}/${chrom.region}:${cursor}..${chunkEnd}?content-type=text/x-fasta`
    onProgress?.({
      fraction: fetched / totalBp,
      loaded: fetched,
      message: `${chrom.name}:${cursor.toLocaleString()}–${chunkEnd.toLocaleString()}`,
    })
    const res = await fetch(url, { signal })
    if (!res.ok) {
      throw new Error(`Ensembl returned ${res.status} for ${chrom.name}:${cursor}..${chunkEnd}`)
    }
    const text = await res.text()
    // Strip the per-chunk FASTA header; we re-wrap with one combined header below.
    const body = text.replace(/^>.*$/m, '').replace(/\s+/g, '')
    seqParts.push(body)
    fetched += chunkEnd - cursor + 1
    cursor = chunkEnd + 1
  }

  const seq = seqParts.join('')
  const header = `>${chrom.name}:${safeStart}-${end} GRCh38 (Ensembl)`
  const wrapped = seq.match(/.{1,60}/g)?.join('\n') ?? seq
  onProgress?.({ fraction: 1, loaded: totalBp, message: `${totalBp.toLocaleString()} bp` })
  return {
    filename: `${chrom.name}_${safeStart}-${end}.fasta`,
    fasta: `${header}\n${wrapped}\n`,
  }
}
