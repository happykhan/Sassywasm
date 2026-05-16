use wasm_bindgen::prelude::*;
use serde::Serialize;
use sassy::{CachedRev, Searcher, Strand, profiles::{Dna, Iupac}};

#[derive(Serialize)]
pub struct MatchResult {
    pub pos: usize,
    pub end: usize,
    pub distance: i32,
    pub matched_seq: String,
    pub cigar: String,
    pub strand: String,
}

fn make_result(text_bytes: &[u8], pos: usize, end: usize, cost: i32, cigar: String, strand: Strand) -> MatchResult {
    let matched = std::str::from_utf8(&text_bytes[pos..end]).unwrap_or("").to_string();
    MatchResult {
        pos,
        end,
        distance: cost,
        matched_seq: matched,
        cigar,
        strand: match strand {
            Strand::Fwd => "fwd".to_string(),
            Strand::Rc  => "rc".to_string(),
        },
    }
}

/// Forward-only DNA search. Returns matches with at most k errors.
#[wasm_bindgen]
pub fn search(pattern: &str, text: &str, k: u32) -> JsValue {
    let pattern_bytes = pattern.as_bytes();
    let text_bytes = text.as_bytes();
    let mut searcher = Searcher::<Dna>::new_fwd();
    let matches = searcher.search(pattern_bytes, text_bytes, k as usize);
    let results: Vec<MatchResult> = matches.iter().map(|m| {
        make_result(text_bytes, m.text_start, m.text_end, m.cost, m.cigar.to_string(), m.strand)
    }).collect();
    serde_wasm_bindgen::to_value(&results).unwrap_or(JsValue::NULL)
}

/// Forward + reverse-complement DNA search. Strand field is "fwd" or "rc".
#[wasm_bindgen]
pub fn search_rc(pattern: &str, text: &str, k: u32) -> JsValue {
    let pattern_bytes = pattern.as_bytes();
    let text_bytes = text.as_bytes();
    let mut searcher = Searcher::<Dna>::new_rc();
    let cached = CachedRev::new(text_bytes, true);
    let matches = searcher.search(pattern_bytes, &cached, k as usize);
    let results: Vec<MatchResult> = matches.iter().map(|m| {
        make_result(text_bytes, m.text_start, m.text_end, m.cost, m.cigar.to_string(), m.strand)
    }).collect();
    serde_wasm_bindgen::to_value(&results).unwrap_or(JsValue::NULL)
}

/// Forward-only IUPAC search — pattern may contain ambiguity codes (R, Y, S, W, K, M, B, D, H, V, N).
#[wasm_bindgen]
pub fn search_iupac(pattern: &str, text: &str, k: u32) -> JsValue {
    let pattern_bytes = pattern.as_bytes();
    let text_bytes = text.as_bytes();
    let mut searcher = Searcher::<Iupac>::new_fwd();
    let matches = searcher.search(pattern_bytes, text_bytes, k as usize);
    let results: Vec<MatchResult> = matches.iter().map(|m| {
        make_result(text_bytes, m.text_start, m.text_end, m.cost, m.cigar.to_string(), m.strand)
    }).collect();
    serde_wasm_bindgen::to_value(&results).unwrap_or(JsValue::NULL)
}

/// IUPAC forward + reverse-complement search — pattern may contain ambiguity codes on both strands.
/// Used for CRISPR PAM matching (e.g. guide+NGG pattern searched on both strands).
#[wasm_bindgen]
pub fn search_iupac_rc(pattern: &str, text: &str, k: u32) -> JsValue {
    let pattern_bytes = pattern.as_bytes();
    let text_bytes = text.as_bytes();
    let mut searcher = Searcher::<Iupac>::new_rc();
    let cached = CachedRev::new(text_bytes, true);
    let matches = searcher.search(pattern_bytes, &cached, k as usize);
    let results: Vec<MatchResult> = matches.iter().map(|m| {
        make_result(text_bytes, m.text_start, m.text_end, m.cost, m.cigar.to_string(), m.strand)
    }).collect();
    serde_wasm_bindgen::to_value(&results).unwrap_or(JsValue::NULL)
}

/// Fast match count — no position or CIGAR tracking. Returns number of matches.
#[wasm_bindgen]
pub fn count(pattern: &str, text: &str, k: u32) -> usize {
    let pattern_bytes = pattern.as_bytes();
    let text_bytes = text.as_bytes();
    let mut searcher = Searcher::<Dna>::new_fwd().without_trace();
    searcher.search(pattern_bytes, text_bytes, k as usize).len()
}
