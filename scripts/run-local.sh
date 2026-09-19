#!/usr/bin/env bash
# Local API + Vite. Uses .venv if `uv` is not on PATH.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export DYLD_FALLBACK_LIBRARY_PATH="${DYLD_FALLBACK_LIBRARY_PATH:-/opt/homebrew/lib}"

if command -v uv >/dev/null 2>&1; then
  API=(uv run hr-breaker-api)
else
  if [[ ! -x .venv/bin/hr-breaker-api ]]; then
    echo "No uv and no .venv/bin/hr-breaker-api. Install uv (https://docs.astral.sh/uv/) or run: python3 -m venv .venv && .venv/bin/pip install -e ." >&2
    exit 1
  fi
  API=(.venv/bin/hr-breaker-api)
fi

exec "${API[@]}"
