#!/bin/bash
# Wrapper for SpookyPirate's AutoMod CLI
# Usage: bash tools/automod-cli.sh <module> <command> [args] --json
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GAME_DIR="$(dirname "$SCRIPT_DIR")"
dotnet run --project "$SCRIPT_DIR/automod/src/SpookysAutomod.Cli" -- "$@"
