#!/bin/sh
# Builds rust/crates/wasm (swarm-wasm) for the web into engine-wasm/pkg/:
#
#   cargo build -p swarm-wasm --target wasm32-unknown-unknown --release
#       (with LTO and opt-level "s", see below)
#   wasm-bindgen --target web --out-dir engine-wasm/pkg \
#       rust/target/wasm32-unknown-unknown/release/swarm_wasm.wasm
#   wasm-opt -Oz (if installed)
#
# Needs: rustup target add wasm32-unknown-unknown, and a wasm-bindgen CLI of
# the same version as the wasm-bindgen crate in rust/Cargo.lock:
#
#   cargo install wasm-bindgen-cli --version <version> --locked
#
# Without the toolchain the build is skipped with a warning (exit 0), so
# `pnpm test:packages` works on machines without Rust; the package's tests
# then skip the wasm suite. Set SWARM_WASM_REQUIRED=1 to make that an error.
# Extra cargo flags: SWARM_WASM_CARGO_FLAGS (e.g. "--no-default-features").
set -eu

here=$(cd "$(dirname "$0")/.." && pwd)
rust="$here/../rust"
out="$here/pkg"

skip() {
    echo "engine-wasm: $1; skipping the wasm build (pkg/ not updated)." >&2
    if [ "${SWARM_WASM_REQUIRED:-0}" = 1 ]; then
        exit 1
    fi
    exit 0
}

command -v cargo >/dev/null 2>&1 || skip "cargo not found"
rustup target list --installed 2>/dev/null | grep -qx wasm32-unknown-unknown \
    || skip "the wasm32-unknown-unknown target is not installed (rustup target add wasm32-unknown-unknown)"
command -v wasm-bindgen >/dev/null 2>&1 || skip "wasm-bindgen not found (cargo install wasm-bindgen-cli --locked --version <the version in rust/Cargo.lock>)"

want=$(awk '/^name = "wasm-bindgen"$/ { getline; gsub(/version = |"/, ""); print; exit }' "$rust/Cargo.lock")
have=$(wasm-bindgen --version | awk '{ print $2 }')
if [ -n "$want" ] && [ "$want" != "$have" ]; then
    skip "wasm-bindgen CLI $have does not match the wasm-bindgen crate $want in rust/Cargo.lock"
fi

# Size over speed for the download: LTO, one codegen unit, opt-level "s"
# (about 850 KB after wasm-opt, 300 KB gzipped, vs 1.05 MB / 350 KB at
# opt-level 3). Only this build is affected; override with the usual
# CARGO_PROFILE_RELEASE_* variables.
export CARGO_PROFILE_RELEASE_LTO="${CARGO_PROFILE_RELEASE_LTO:-true}"
export CARGO_PROFILE_RELEASE_CODEGEN_UNITS="${CARGO_PROFILE_RELEASE_CODEGEN_UNITS:-1}"
export CARGO_PROFILE_RELEASE_OPT_LEVEL="${CARGO_PROFILE_RELEASE_OPT_LEVEL:-s}"

# shellcheck disable=SC2086
(cd "$rust" && cargo build -p swarm-wasm --target wasm32-unknown-unknown --release ${SWARM_WASM_CARGO_FLAGS:-})
wasm="$rust/target/wasm32-unknown-unknown/release/swarm_wasm.wasm"

rm -rf "$out"
wasm-bindgen --target web --out-dir "$out" "$wasm"

bg="$out/swarm_wasm_bg.wasm"
if command -v wasm-opt >/dev/null 2>&1; then
    wasm-opt -Oz --enable-bulk-memory --enable-nontrapping-float-to-int --enable-sign-ext \
        --enable-mutable-globals --enable-reference-types --enable-multivalue \
        -o "$bg.opt" "$bg"
    mv "$bg.opt" "$bg"
else
    echo "engine-wasm: wasm-opt not found; pkg/ is not size-optimised" >&2
fi
echo "engine-wasm: built $(wc -c < "$bg") bytes into pkg/"
