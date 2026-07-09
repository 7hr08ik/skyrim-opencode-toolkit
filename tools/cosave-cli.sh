#!/bin/bash
# Wrapper for cosave-info.py — READ-ONLY structural survey of an SKSE .skse co-save -> JSON on stdout.
# Shows which mods stashed co-save data (StorageUtil/JContainers/per-mod blobs) and how much — the
# mod-state landscape the .ess itself never exposes. Never writes the cosave.
#
# Usage: bash tools/cosave-cli.sh <cosave.skse>
#   The cosave sits next to its save: Save123_....skse  alongside  Save123_....ess
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

# Resolve a working Python 3. Order matters on Windows: `py -3` (the python.org launcher) and
# `python` are reliable, while a bare `python3` is often the Microsoft Store stub that opens the
# Store instead of running — so try those first and only fall back to `python3` (the norm on
# Linux/macOS). The `sys.version_info[0]==3` guard rejects a stray Python 2 `python`.
PY=""
for c in "py -3" "python" "python3"; do
  if $c -c 'import sys; sys.exit(0 if sys.version_info[0]==3 else 1)' >/dev/null 2>&1; then PY="$c"; break; fi
done
if [ -z "$PY" ]; then
  echo '{"ok":false,"error":"Python 3 not found — tried \"py -3\", \"python\", \"python3\". Install Python 3 (python.org) and ensure it is on PATH."}'
  exit 1
fi
exec $PY "$HERE/cosave-info.py" "$@"
