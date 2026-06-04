// Shared FASTA / DNA parsing helpers. Extracted from App.tsx so the reference
// genome selector and the tool page operate on the same parsing logic.

export interface FastaRecord {
  id: string
  seq: string
}

/** Parse multi-record FASTA text into {id, seq} records. */
export function parseFasta(content: string): FastaRecord[] {
  const seqs: FastaRecord[] = []
  let current: FastaRecord | null = null
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

/** Return the sequence of the first FASTA record, or the trimmed input if it is not FASTA. */
export function parseFastaFirst(content: string): string {
  const seqs = parseFasta(content)
  return seqs[0]?.seq ?? content.trim()
}

/** Uppercase and strip to canonical DNA bases (ACGT). */
export function cleanDna(s: string): string {
  return s.trim().toUpperCase().replace(/[^ACGT]/g, '')
}

/** Uppercase and strip to IUPAC nucleotide codes. */
export function cleanIupac(s: string): string {
  return s.trim().toUpperCase().replace(/[^ACGTRYMKSWHBDVN]/g, '')
}
