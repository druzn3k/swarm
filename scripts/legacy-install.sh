#!/bin/sh
# Install the old AngularJS game (swarmsim-coffee), which stays on Yarn 1.
# It consumes the built `tables` and `swarmsim-ts` packages through yarn links,
# so build those first (`pnpm --filter @swarmsim/tables build`, then
# `pnpm --filter @swarmsim/ts build`).
set -eu
# the root package.json names pnpm as its package manager; Yarn 1 refuses to
# run under it unless told to skip that check
export SKIP_YARN_COREPACK_CHECK=1
cd "$(dirname "$0")/.."
(cd tables && yarn link)
(cd swarmsim-ts && yarn link)
cd swarmsim-coffee
yarn link @swarmsim/tables
yarn link @swarmsim/ts
yarn install --frozen-lockfile
