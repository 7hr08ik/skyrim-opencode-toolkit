#!/bin/bash
# Auto-snapshot active .psc/.pex files before EVERY Bash command.
#
# Rationale: backup-before-edit.sh only fires for Edit/Write tool calls.
# External tools invoked via Bash (AutoMod, PapyrusAssembler, Champollion,
# Caprica, Spriggit, and unknown future tools) bypass that hook entirely.
# Some tools (e.g. a failed decompile) silently destroy their output files.
# We can't reliably classify which commands are "risky", so we snapshot before
# every Bash command. Files are small, snapshots are fast, and a rate limit
# prevents spam during command bursts.
#
# SETUP: setup.sh fills the JQ placeholder below with your jq path.

JQ="{{JQ_PATH}}"

INPUT=$(cat /dev/stdin)
COMMAND=$(echo "$INPUT" | "$JQ" -r '.tool_input.command // empty')

# Skip purely informational commands that obviously can't write files.
echo "$COMMAND" | grep -qE '^\s*(ls|cat|head|tail|grep|find|wc|file|stat|pwd|echo|date|whoami|which|type|env|printenv)\s' && exit 0
echo "$COMMAND" | grep -qE '^\s*git\s+(status|log|diff|show|branch|remote|config\s+--get)' && exit 0

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
SNAPSHOT_BASE="$CLAUDE_PROJECT_DIR/.claude/backups/auto_snapshots"
SOURCE_DIR="$CLAUDE_PROJECT_DIR/Data/Scripts/Source"
DEPLOY_DIR="$CLAUDE_PROJECT_DIR/Data/Scripts"
RATE_LIMIT_FILE="$SNAPSHOT_BASE/.last_snapshot"
mkdir -p "$SNAPSHOT_BASE"

# Skip if the source directory doesn't exist (no Papyrus dev in this install).
[ -d "$SOURCE_DIR" ] || exit 0

# Rate limit: skip if we snapshotted within the last 60 seconds AND no .psc has
# been modified since the last snapshot.
NOW_EPOCH=$(date +%s)
if [ -f "$RATE_LIMIT_FILE" ]; then
    LAST_EPOCH=$(cat "$RATE_LIMIT_FILE")
    AGE=$((NOW_EPOCH - LAST_EPOCH))
    if [ "$AGE" -lt 60 ]; then
        NEWER=$(find "$SOURCE_DIR" -maxdepth 1 -name "*.psc" -newer "$RATE_LIMIT_FILE" -type f 2>/dev/null | head -1)
        [ -z "$NEWER" ] && exit 0
    fi
fi

SNAPSHOT_DIR="$SNAPSHOT_BASE/${TIMESTAMP}"
mkdir -p "$SNAPSHOT_DIR/source" "$SNAPSHOT_DIR/deploy"

# Snapshot .psc files modified in the last 7 days (active dev files only —
# avoids copying all 4000+ vanilla scripts every run).
find "$SOURCE_DIR" -maxdepth 1 -name "*.psc" -mtime -7 -type f \
    -exec cp {} "$SNAPSHOT_DIR/source/" \; 2>/dev/null

# Snapshot .pex files modified in the last 7 days (deployed compiled scripts).
[ -d "$DEPLOY_DIR" ] && find "$DEPLOY_DIR" -maxdepth 1 -name "*.pex" -mtime -7 -type f \
    -exec cp {} "$SNAPSHOT_DIR/deploy/" \; 2>/dev/null

PSC_COUNT=$(ls "$SNAPSHOT_DIR/source/" 2>/dev/null | wc -l)
PEX_COUNT=$(ls "$SNAPSHOT_DIR/deploy/" 2>/dev/null | wc -l)

# If nothing was snapshotted, remove the empty dirs to avoid clutter.
if [ "$PSC_COUNT" = "0" ] && [ "$PEX_COUNT" = "0" ]; then
    rm -rf "$SNAPSHOT_DIR"
    exit 0
fi

# Update rate-limit timestamp.
date +%s > "$RATE_LIMIT_FILE"

# Log to audit trail.
AUDIT_LOG="$CLAUDE_PROJECT_DIR/.claude/backups/AUDIT_LOG.txt"
SHORT_CMD=$(echo "$COMMAND" | head -c 120)
echo "[$TIMESTAMP] AUTO-SNAPSHOT (psc:$PSC_COUNT pex:$PEX_COUNT) before: $SHORT_CMD" >> "$AUDIT_LOG"

# Prune snapshots older than 14 days to avoid unbounded growth.
find "$SNAPSHOT_BASE" -maxdepth 1 -type d -mtime +14 -exec rm -rf {} \; 2>/dev/null

exit 0
