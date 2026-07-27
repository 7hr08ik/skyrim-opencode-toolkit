#!/bin/bash
# devbench-cli.sh -- talk to a RUNNING Skyrim via alandtse's DevBench SKSE plugin.
#
# DevBench (Nexus SE 181326) runs a localhost REST+MCP server inside the live game, so Claude can
# inspect state, run console commands AND READ THEIR OUTPUT, call Papyrus functions, and drive
# scripted scenarios -- instead of you hand-testing and reporting back.
#
# NOT bundled: install DevBench yourself from Nexus (GPL-3.0). This wrapper just drives its REST API.
#
# The game must be RUNNING with a save loaded. When it isn't, the port is dead and every call here
# fails fast with a clear message -- fall back to the offline tools (xelib/Spriggit/ReSaver).
#
# Usage:
#   bash tools/devbench-cli.sh ping                       # is the server up?
#   bash tools/devbench-cli.sh alive                      # is the GAME actually running (not hung)?
#   bash tools/devbench-cli.sh state                      # {plugin,version,vr,playerLoaded,frame}
#   bash tools/devbench-cli.sh inspect vm                 # kinds: state vm scene mods player
#                                                         #        inventory quests effects refs
#   bash tools/devbench-cli.sh exec "player.getav health" # console exec + capture + read output
#   bash tools/devbench-cli.sh call Utility GetCurrentGameTime
#   bash tools/devbench-cli.sh call Actor IsInCombat '[]' '{"form":"0x14"}'
#   bash tools/devbench-cli.sh tool menu '{"action":"accept"}'   # raw escape hatch: any tool, any JSON
#
# Port: read from Data/SKSE/Plugins/devbench/runtime.json when present, else the per-runtime default
# (VR 8921, SE/AE 8920). Override with DEVBENCH_PORT=nnnn.

set -u
# Every command here pipes post() into a formatter; without pipefail a dead server (post -> 1)
# would be masked by the formatter's 0 and the caller would think the call succeeded.
set -o pipefail

GAME_DIR="${GAME_DIR:-$(pwd)}"
RUNTIME_JSON="$GAME_DIR/Data/SKSE/Plugins/devbench/runtime.json"

command -v curl >/dev/null 2>&1 || { echo "ERROR: curl not found." >&2; exit 1; }
HAVE_JQ=0; command -v jq >/dev/null 2>&1 && HAVE_JQ=1

# --- Resolve the port -------------------------------------------------------
resolve_port() {
    if [ -n "${DEVBENCH_PORT:-}" ]; then echo "$DEVBENCH_PORT"; return; fi
    # DevBench writes the port it actually bound here (it iterates if the default was taken).
    if [ -f "$RUNTIME_JSON" ]; then
        p=$(tr -dc '0-9' < "$RUNTIME_JSON" 2>/dev/null | head -c 5)
        [ -n "$p" ] && { echo "$p"; return; }
    fi
    # Fall back to the deterministic per-runtime default.
    [ -f "$GAME_DIR/SkyrimVR.exe" ] && { echo 8921; return; }
    echo 8920
}
PORT="$(resolve_port)"
BASE="http://127.0.0.1:$PORT"

pretty() { if [ "$HAVE_JQ" -eq 1 ]; then jq . 2>/dev/null || cat; else cat; fi; }

# POST a tool call. Fails fast (and loudly) when the game isn't running.
post() { # $1=tool  $2=json
    local out rc body
    body="${2:-}"; [ -n "$body" ] || body='{}'
    out=$(curl -s --max-time 15 -X POST "$BASE/api/tool/$1" \
              -H "Content-Type: application/json" -d "$body" 2>&1)
    rc=$?
    if [ $rc -ne 0 ] || [ -z "$out" ]; then
        echo "ERROR: no response from DevBench on port $PORT." >&2
        echo "  The game must be RUNNING with a save loaded (VR: headset on -- Skyrim VR" >&2
        echo "  cannot init without it). If it IS running, check the bound port in" >&2
        echo "  Data/SKSE/Plugins/devbench/runtime.json or set DEVBENCH_PORT." >&2
        return 1
    fi
    printf '%s' "$out"
}

jget() { # read a field without hard-depending on jq
    if [ "$HAVE_JQ" -eq 1 ]; then jq -r "$1 // empty" 2>/dev/null
    else sed -n "s/.*\"${1##*.}\"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p" | head -1; fi
}

CMD="${1:-}"; shift 2>/dev/null || true

case "$CMD" in
  ping)
      post ping '{}' | pretty ;;

  alive)
      # HARD-WON: `ping` proves only that the HTTP thread is alive -- it runs on a SEPARATE thread
      # from the game. A hung/deadlocked game still answers ping. The real liveness test is whether
      # the frame counter ADVANCES between two reads. A static frame = paused (in a menu) or hung.
      f1=$(post inspect '{"kind":"state"}' | jget '.frame') || exit 1
      sleep 1
      f2=$(post inspect '{"kind":"state"}' | jget '.frame') || exit 1
      if [ -z "$f1" ] || [ -z "$f2" ]; then
          echo "UNKNOWN: could not read frame counter (is a save loaded?)"; exit 1
      fi
      if [ "$f1" != "$f2" ]; then
          echo "RUNNING  (frame $f1 -> $f2)"
      else
          echo "NOT ADVANCING (frame stuck at $f1) -- game is paused (menu) or hung."
          echo "  While paused, console 'exec' only QUEUES and Papyrus OnUpdate does not fire."
          echo "  Read tools (inspect) still work paused; write/act tools do not."
          exit 2
      fi ;;

  state)
      post inspect '{"kind":"state"}' | pretty ;;

  inspect)
      kind="${1:-state}"
      post inspect "{\"kind\":\"$kind\"}" | pretty ;;

  exec)
      # Console output capture is a two-step fence: exec with capture, then read the slice.
      [ $# -ge 1 ] || { echo "usage: devbench-cli.sh exec \"<console command>\"" >&2; exit 1; }
      cmd="$*"
      if [ "$HAVE_JQ" -eq 1 ]; then payload=$(jq -nc --arg c "$cmd" '{action:"exec",command:$c,capture:true}')
      else payload="{\"action\":\"exec\",\"command\":\"$cmd\",\"capture\":true}"; fi
      post console "$payload" >/dev/null || exit 1
      sleep 1   # commands are queued on the game thread; they land on a later frame
      post console '{"action":"read"}' | pretty
      # NOTE: many commands (addmusic/removemusic/...) produce NO console output. count:0 is normal
      # -- judge the result by re-reading state, not by the captured lines.
      ;;

  call)
      # papyrus call: globals/native omit `self`; member functions pass it.
      [ $# -ge 2 ] || { echo "usage: devbench-cli.sh call <Script> <Function> [argsJson] [selfJson]" >&2; exit 1; }
      script="$1"; func="$2"; args="${3:-[]}"; slf="${4:-}"
      if [ -n "$slf" ]; then
          payload="{\"action\":\"call\",\"script\":\"$script\",\"function\":\"$func\",\"args\":$args,\"self\":$slf}"
      else
          payload="{\"action\":\"call\",\"script\":\"$script\",\"function\":\"$func\",\"args\":$args}"
      fi
      post papyrus "$payload" | pretty
      # NOTE: omitted TRAILING optional params are padded with neutral defaults (None/0/false/"").
      # For reference ops (MoveTo/Disable/Kill) a short arg list silently no-ops -- pass them explicitly.
      ;;

  describe)
      [ $# -ge 1 ] || { echo "usage: devbench-cli.sh describe <Script>" >&2; exit 1; }
      post papyrus "{\"action\":\"describe\",\"script\":\"$1\"}" | pretty ;;

  notify)
      # HUD narration -- the user cannot see this chat while in the headset. Narrate live tests
      # in-game so the whole sequence is self-explaining.
      [ $# -ge 1 ] || { echo "usage: devbench-cli.sh notify \"text\"" >&2; exit 1; }
      if [ "$HAVE_JQ" -eq 1 ]; then payload=$(jq -nc --arg t "$*" '{action:"call",script:"Debug",function:"Notification",args:[$t]}')
      else payload="{\"action\":\"call\",\"script\":\"Debug\",\"function\":\"Notification\",\"args\":[\"$*\"]}"; fi
      post papyrus "$payload" | pretty ;;

  tool)
      [ $# -ge 1 ] || { echo "usage: devbench-cli.sh tool <name> [json]" >&2; exit 1; }
      post "$1" "${2:-}" | pretty ;;

  tools)
      curl -s --max-time 15 "$BASE/api/tools" | pretty ;;

  port)
      echo "$PORT" ;;

  ""|-h|--help|help)
      sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//' ;;

  *)
      echo "Unknown command: $CMD" >&2
      echo "Try: ping | alive | state | inspect <kind> | exec | call | describe | notify | tool | tools | port" >&2
      exit 1 ;;
esac
