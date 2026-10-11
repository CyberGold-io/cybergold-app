#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
forbidden='NEXT_PUBLIC_(CG|GC)_[A-Z0-9_]+|NEXT_PUBLIC_CYGLD_ADDRESS|NEXT_PUBLIC_SAFE_TX_SERVICE_URL|\bCG_[A-Z0-9_]*\b|\bGC_[A-Z0-9_]*\b'

if ! command -v git >/dev/null 2>&1; then
  echo "ERROR: git is required for the naming policy gate." >&2
  exit 1
fi

if git -C "$ROOT" grep -n -E "$forbidden" -- \
  README.md app env messages scripts tests ':(exclude)scripts/check-naming.sh'; then
  echo "ERROR: forbidden legacy naming or browser-exposed Safe service configuration remains." >&2
  exit 1
else
  grep_status=$?
  if [[ "$grep_status" -ne 1 ]]; then
    echo "ERROR: git grep could not complete the naming policy scan (exit $grep_status)." >&2
    exit "$grep_status"
  fi
fi
