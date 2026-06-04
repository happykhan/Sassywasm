# Vendored `wide` 1.4.0 — wasm64 SIMD patch

This is a verbatim copy of `wide` 1.4.0 (https://crates.io/crates/wide,
zlib licence, see LICENSE-ZLIB.md) with one targeted change so that the
`+simd128` code path compiles for the `wasm64-unknown-unknown` target.

## Why

Upstream `wide` gates its WebAssembly SIMD types on `target_feature="simd128"`
and unconditionally does `use core::arch::wasm32::*;`. On wasm64 that module
does not exist (`core::arch::wasm32` is `#[cfg(target_arch = "wasm32")]`), so a
`+simd128` build for wasm64 fails with `unresolved import core::arch::wasm32`.
sassy depends on `wide` unconditionally (its `scalar` feature only affects
`ensure_simd`), so without this patch the wasm64 build must drop SIMD and run
the scalar fallback.

## The change

1. `src/lib.rs`: add `#![cfg_attr(target_arch = "wasm64", feature(simd_wasm64))]`
   so the unstable `core::arch::wasm64` intrinsics are available on that target.
2. Every `use core::arch::wasm32::*;` inside a `simd128` branch is replaced with
   an arch-gated pair:
   ```rust
   #[cfg(target_arch = "wasm32")]
   use core::arch::wasm32::*;
   #[cfg(target_arch = "wasm64")]
   use core::arch::wasm64::*;
   ```
   `core::arch::wasm64` re-exports the same intrinsics as `wasm32`, so the SIMD
   code below is unchanged.

The patch is a no-op on wasm32 and native targets: they keep the upstream
`wasm32` path and never see the `simd_wasm64` feature attribute.

Referenced from `sassy-wasm/Cargo.toml` via `[patch.crates-io] wide = { path = ... }`.
