declare module 'sassy-wasm' {
  type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module

  export function search(pattern: string, text: string, k: number): Array<{
    pos: number
    end: number
    distance: number
    matched_seq: string
    cigar: string
  }>

  export default function init(
    module_or_path?: InitInput | Promise<InitInput>
  ): Promise<unknown>
}
