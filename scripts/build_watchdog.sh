#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE=debug
if [[ "${1:-}" == "--release" ]]; then
  PROFILE=release
fi

CARGO_ARGS=(build --manifest-path "$ROOT/watchdog/Cargo.toml" --locked)
if [[ "$PROFILE" == release ]]; then
  CARGO_ARGS+=(--release)
fi
cargo "${CARGO_ARGS[@]}"
SOURCE="$ROOT/watchdog/target/$PROFILE/hvideo-watchdog"
test -x "$SOURCE"
mkdir -p "$ROOT/target/$PROFILE" "$ROOT/src-tauri/target/$PROFILE"
cp "$SOURCE" "$ROOT/target/$PROFILE/hvideo-watchdog"
cp "$SOURCE" "$ROOT/src-tauri/target/$PROFILE/hvideo-watchdog"
