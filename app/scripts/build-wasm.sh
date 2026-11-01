#!/bin/sh
# The app runs the Rust engine as WebAssembly (@swarmsim/engine-wasm). Builds
# it (engine-wasm/scripts/build-wasm.sh, which skips with a warning when the
# Rust toolchain is missing, or fails with SWARM_WASM_REQUIRED=1), then
# checks that there is a build to bundle: without one the app can't run, so
# this fails with what to install.
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
pkg="$here/../engine-wasm/pkg/swarm_wasm_bg.wasm"
sh "$here/../engine-wasm/scripts/build-wasm.sh"
if [ ! -f "$pkg" ]; then
    cat >&2 <<MSG
app: the wasm engine is not built ($pkg is missing), and the app needs it.
Install the Rust toolchain, then build again:
    rustup target add wasm32-unknown-unknown
    cargo install wasm-bindgen-cli --locked --version 0.2.130
    pnpm --filter @swarmsim/engine-wasm build
MSG
    exit 1
fi
