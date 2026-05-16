use wasm_bindgen::prelude::*;
use serde::Serialize;
use sassy::{Searcher, profiles::Dna};

#[derive(Serialize)]
struct MatchResult {
    pos: usize,
    end: usize,
    distance: i32,
    matched_seq: String,
    cigar: String,
}

/// Search for approximate matches of `pattern` in `text` with at most `k` errors.
/// Returns a JSON array of match objects.
#[wasm_bindgen]
pub fn search(pattern: &str, text: &str, k: u32) -> JsValue {
    let pattern_bytes = pattern.as_bytes();
    let text_bytes = text.as_bytes();

    let mut searcher = Searcher::<Dna>::new_fwd();
    let matches = searcher.search(pattern_bytes, text_bytes, k as usize);

    let results: Vec<MatchResult> = matches
        .iter()
        .map(|m| {
            let start = m.text_start;
            let end = m.text_end;
            let matched = std::str::from_utf8(&text_bytes[start..end]).unwrap_or("").to_string();
            MatchResult {
                pos: start,
                end,
                distance: m.cost,
                matched_seq: matched,
                cigar: m.cigar.to_string(),
            }
        })
        .collect();

    serde_wasm_bindgen::to_value(&results).unwrap_or(JsValue::NULL)
}
