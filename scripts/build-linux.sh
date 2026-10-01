#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

LINUX_RESOURCES="$ROOT/.linux-build-resources"
cleanup() {
  rm -rf "$LINUX_RESOURCES"
}
trap cleanup EXIT

command -v cargo >/dev/null || { echo "cargo is required" >&2; exit 1; }
command -v node >/dev/null || { echo "node is required" >&2; exit 1; }
command -v npx >/dev/null || { echo "npx is required" >&2; exit 1; }
command -v bash >/dev/null || { echo "bash is required" >&2; exit 1; }

rm -rf "$LINUX_RESOURCES"
mkdir -p "$LINUX_RESOURCES"
cp "$ROOT/config.toml" "$LINUX_RESOURCES/config.toml"
sed -i \
  -e 's/^host = "[^"]*"$/host = "0.0.0.0"/' \
  -e 's#^media_root = "[^"]*"$#media_root = "./storage/media"#' \
  "$LINUX_RESOURCES/config.toml"

bash scripts/build_watchdog.sh --release
cargo build --manifest-path src-tauri/Cargo.toml --release --features custom-protocol
npx tauri build --config src-tauri/tauri.linux.conf.json

echo "Linux bundles are in: $ROOT/src-tauri/target/release/bundle"
