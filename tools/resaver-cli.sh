#!/bin/bash
# Wrapper for ResaverCLI — headless driver for ReSaver's (FallrimTools) save library.
# Parses/queries/edits Skyrim SE/VR .ess saves and emits JSON on stdout.
#
# Usage: bash tools/resaver-cli.sh <op> <save.ess> [args...]
#   info       <save>
#   dump       <save> <subsystem> [--limit N] [--undefined-only] [--script <name>] [--type <T>]
#                                 (scriptinstances|activescripts|references|structinstances|scripts|globals|changeforms)
#   find-refs  <save> <eidHex>    who references this element (labels direct vs secondary)
#   find       <save> <query>     query = <Plugin.esp:formid> | <formidHex> | <script-name substring>
#   worries    <save>             ReSaver's Worrier problem report (fatal/performance/potential)
#   set-global <save> <target> <value> [<out.ess>] [--apply]      target = formidHex | Plugin.esp:formid
#   set-var    <save> <eidHex> [<index> <value> <out.ess>] [--type int|float|bool|str] [--apply]
#   clean      <save> <out.ess> [--undefined] [--unattached] [--terminate-threads] [--apply]
#                                 dry-run unless --apply; writes to a NEW file, auto-backs-up + handles .skse
#
# Notes: writes NEVER overwrite the input save. Always review dry-run output before --apply.
# Names: ResaverCLI emits Plugin:FORMID; resolve to EditorIDs on demand via tools/resaver-resolve-names.js.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd -W 2>/dev/null)"
[ -z "$HERE" ] && HERE="$(cd "$(dirname "$0")" && pwd)"
TOOL="$HERE/resaver-cli"
CP="$TOOL/ReSaver.jar;$TOOL/lib/*"

# Compile the driver once (or when the source is newer than the class).
if [ ! -f "$TOOL/ResaverCLI.class" ] || [ "$TOOL/ResaverCLI.java" -nt "$TOOL/ResaverCLI.class" ]; then
  javac -cp "$CP" -d "$TOOL" "$TOOL/ResaverCLI.java" >&2 || { echo '{"ok":false,"error":"compile failed"}'; exit 1; }
fi

exec java --enable-native-access=ALL-UNNAMED --sun-misc-unsafe-memory-access=allow -cp "$TOOL;$CP" ResaverCLI "$@"
