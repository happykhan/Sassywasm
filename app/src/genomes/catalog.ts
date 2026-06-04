// Curated reference-genome catalogue for the on-the-fly downloader.
//
// Two source families, both CORS-friendly so fetches work straight from the
// browser on GitHub Pages — no server or proxy required:
//
//   * Bacteria — EBI ENA (https://www.ebi.ac.uk/ena/browser/api/fasta/<accession>)
//     returns the complete chromosome as FASTA with `access-control-allow-origin: *`.
//     Whole bacterial genomes are only ~2–6 Mbp, so we fetch them in full.
//
//   * Human chromosomes — Ensembl REST
//     (https://rest.ensembl.org/sequence/region/human/<chr>:<start>..<end>).
//     A full human chromosome is hundreds of Mbp and would OOM the browser and
//     the WASM matcher, so we fetch a bounded *region* instead (default the
//     first window). Ensembl caps a single request at 10 Mbp; the fetch helper
//     respects that.

export type GenomeKind = 'bacteria' | 'human'

export interface BacterialGenome {
  kind: 'bacteria'
  id: string
  /** Human-readable organism / strain name. */
  name: string
  /** ENA sequence accession (with version). */
  accession: string
  /** Approximate genome length in bp, for display only. */
  approxLength: number
}

export interface HumanChromosome {
  kind: 'human'
  id: string
  /** UCSC-style label, e.g. "chr1". */
  name: string
  /** Ensembl region name, e.g. "1", "X", "Y". */
  region: string
  /** Full chromosome length in bp (GRCh38). */
  length: number
}

export type CatalogEntry = BacterialGenome | HumanChromosome

// EBI ENA region cap is generous; Ensembl caps a single request at 10 Mbp.
export const ENSEMBL_MAX_REGION = 10_000_000

// Default window fetched for a human chromosome when the user does not narrow it.
export const DEFAULT_HUMAN_WINDOW = 1_000_000

// A handful of clinically and historically important bacteria. Accessions are
// the canonical complete reference chromosomes on ENA.
export const BACTERIA: BacterialGenome[] = [
  { kind: 'bacteria', id: 'ecoli-k12',   name: 'Escherichia coli K-12 MG1655',        accession: 'U00096.3',   approxLength: 4_641_652 },
  { kind: 'bacteria', id: 'ecoli-o157',  name: 'Escherichia coli O157:H7 EDL933',     accession: 'AE005174.2', approxLength: 5_528_445 },
  { kind: 'bacteria', id: 'saureus',     name: 'Staphylococcus aureus MRSA252',       accession: 'BX571856.1', approxLength: 2_902_619 },
  { kind: 'bacteria', id: 'mtb',         name: 'Mycobacterium tuberculosis H37Rv',    accession: 'AL123456.3', approxLength: 4_411_532 },
  { kind: 'bacteria', id: 'kpneu',       name: 'Klebsiella pneumoniae NTUH-K2044',    accession: 'AP006725.1', approxLength: 5_248_520 },
  { kind: 'bacteria', id: 'paeruginosa', name: 'Pseudomonas aeruginosa PAO1',         accession: 'AE004091.2', approxLength: 6_264_404 },
  { kind: 'bacteria', id: 'styphi',      name: 'Salmonella enterica Typhi CT18',      accession: 'AL513382.1', approxLength: 4_809_037 },
  { kind: 'bacteria', id: 'cdiff',       name: 'Clostridioides difficile 630',        accession: 'AM180355.1', approxLength: 4_290_252 },
]

// Human autosomes + sex chromosomes (GRCh38 lengths).
export const HUMAN_CHROMOSOMES: HumanChromosome[] = [
  { kind: 'human', id: 'chr1',  name: 'chr1',  region: '1',  length: 248_956_422 },
  { kind: 'human', id: 'chr2',  name: 'chr2',  region: '2',  length: 242_193_529 },
  { kind: 'human', id: 'chr3',  name: 'chr3',  region: '3',  length: 198_295_559 },
  { kind: 'human', id: 'chr4',  name: 'chr4',  region: '4',  length: 190_214_555 },
  { kind: 'human', id: 'chr5',  name: 'chr5',  region: '5',  length: 181_538_259 },
  { kind: 'human', id: 'chr6',  name: 'chr6',  region: '6',  length: 170_805_979 },
  { kind: 'human', id: 'chr7',  name: 'chr7',  region: '7',  length: 159_345_973 },
  { kind: 'human', id: 'chr8',  name: 'chr8',  region: '8',  length: 145_138_636 },
  { kind: 'human', id: 'chr9',  name: 'chr9',  region: '9',  length: 138_394_717 },
  { kind: 'human', id: 'chr10', name: 'chr10', region: '10', length: 133_797_422 },
  { kind: 'human', id: 'chr11', name: 'chr11', region: '11', length: 135_086_622 },
  { kind: 'human', id: 'chr12', name: 'chr12', region: '12', length: 133_275_309 },
  { kind: 'human', id: 'chr13', name: 'chr13', region: '13', length: 114_364_328 },
  { kind: 'human', id: 'chr14', name: 'chr14', region: '14', length: 107_043_718 },
  { kind: 'human', id: 'chr15', name: 'chr15', region: '15', length: 101_991_189 },
  { kind: 'human', id: 'chr16', name: 'chr16', region: '16', length:  90_338_345 },
  { kind: 'human', id: 'chr17', name: 'chr17', region: '17', length:  83_257_441 },
  { kind: 'human', id: 'chr18', name: 'chr18', region: '18', length:  80_373_285 },
  { kind: 'human', id: 'chr19', name: 'chr19', region: '19', length:  58_617_616 },
  { kind: 'human', id: 'chr20', name: 'chr20', region: '20', length:  64_444_167 },
  { kind: 'human', id: 'chr21', name: 'chr21', region: '21', length:  46_709_983 },
  { kind: 'human', id: 'chr22', name: 'chr22', region: '22', length:  50_818_468 },
  { kind: 'human', id: 'chrX',  name: 'chrX',  region: 'X',  length: 156_040_895 },
  { kind: 'human', id: 'chrY',  name: 'chrY',  region: 'Y',  length:  57_227_415 },
]
