// Hands a fetched genome from the Reference Genomes page to the tool page,
// where it is consumed as if the user had uploaded a FASTA file. Uses
// sessionStorage so it survives the client-side route change but not a reload.

const KEY = 'sassywasm.genome-handoff'

export interface GenomeHandoff {
  /** Suggested filename, mirrors an uploaded file's name. */
  filename: string
  /** Raw FASTA text. */
  fasta: string
}

export function setGenomeHandoff(payload: GenomeHandoff): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(payload))
  } catch {
    // Storage may be unavailable (private mode); the caller falls back to a download.
  }
}

export function takeGenomeHandoff(): GenomeHandoff | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    sessionStorage.removeItem(KEY)
    return JSON.parse(raw) as GenomeHandoff
  } catch {
    return null
  }
}
