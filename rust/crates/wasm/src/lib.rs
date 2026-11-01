//! Swarm Simulator in the browser: a `wasm-bindgen` boundary over
//! `swarm-engine` and `swarm-save` (`rust/PLAN.md` sections 4 and 7, M5).
//!
//! The boundary is flat: JSON strings in and out (`Command`, `ViewRequest`,
//! `View`, `StaticView`, outcomes and reports, exactly as the engine's serde
//! types write them), `Num` as its canonical string, times as JS numbers
//! (epoch or delta milliseconds). Errors become JS exceptions carrying the
//! engine's message. The TypeScript wrapper and types live in
//! `engine-wasm/` at the repository root.
//!
//! [`core`] is the boundary in plain Rust, tested natively; the
//! `wasm-bindgen` shell ([`Game`] and the free functions) exists on wasm32
//! only.
#![forbid(unsafe_code)]
#![warn(missing_docs)]

pub mod core;

#[cfg(target_arch = "wasm32")]
mod bindings;
#[cfg(target_arch = "wasm32")]
pub use bindings::*;

#[cfg(test)]
mod tests;
