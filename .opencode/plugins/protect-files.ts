// protect-files.ts
// Protect ALL files from unnoticed edits. Every edit requires explicit confirmation
// unless it's in our own workspace (.opencode/hooks, .opencode/plans, .opencode/backups).
//
// Hard blocks:
//   - Direct writes to binary plugin/archive files (.esp, .esm, .esl, .bsa, .ba2)
//
// Requires confirmation for:
//   - Skyrim config files (Skyrim.ini, SkyrimVR.ini, SkyrimPrefs.ini, etc.)
//   - SKSE plugin configs
//   - Load order files (loadorder.txt, plugins.txt)
//   - Papyrus scripts (.pex, .psc)
//   - Any file in game/config directories

function makeOverride(decision: "deny" | "ask", reason: string) {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: decision,
      permissionDecisionReason: reason,
    },
  };
}

// Hard-blocked binary formats
const BINARY_EXT = /\.(esp|esm|esl|bsa|ba2)$/i;

// Whitelisted workspace paths (no confirmation needed)
const WORKSPACE_PATTERNS = [
  /\.opencode\/(hooks|plans|backups|memory)\//,
  /\.opencode\/projects\//,
];

// High-priority confirmation targets
const CONFIG_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern:
      /(Skyrim\.ini|SkyrimVR\.ini|SkyrimPrefs\.ini|SkyrimCustom\.ini)$/i,
    reason: "EDITING SKYRIM CONFIG: ",
  },
  {
    pattern: /Data\/SKSE\/Plugins\/.*\.ini$/i,
    reason: "EDITING SKSE PLUGIN CONFIG: ",
  },
  {
    pattern: /(loadorder\.txt|plugins\.txt)$/i,
    reason: "EDITING LOAD ORDER FILE: ",
  },
  {
    pattern: /\.(pex|psc)$/i,
    reason: "EDITING PAPYRUS SCRIPT: ",
  },
];

// Catch-all for game/config directories
const GAME_DIR_PATTERN = /(Skyrim VR|Skyrim Special Edition|My Games\/Skyrim)/i;

export const ProtectFiles = async (context: any) => {
  return {
    event: async ({ event }: { event: any }) => {
      try {
        if (event.type !== "tool.execute.before") return;

        const data = event.data || {};
        const toolName = data.tool_name || "";

        // Only applies to file-editing tools
        if (
          toolName !== "Edit" &&
          toolName !== "Write" &&
          toolName !== "WriteFile" &&
          toolName !== "MultiEdit"
        ) {
          return;
        }

        const filePath = data.tool_input?.file_path;
        if (!filePath) return;

        // === HARD BLOCK -- binary plugin/archive files ===
        if (BINARY_EXT.test(filePath)) {
          return makeOverride(
            "deny",
            "BLOCKED: Cannot directly write to plugin/archive files. Use xelib or modding tools."
          );
        }

        // === WHITELIST -- our own workspace (no confirmation needed) ===
        if (WORKSPACE_PATTERNS.some((p) => p.test(filePath))) {
          return;
        }

        // === HIGH-PRIORITY CONFIRM ===
        for (const { pattern, reason } of CONFIG_PATTERNS) {
          if (pattern.test(filePath)) {
            return makeOverride("ask", reason + filePath);
          }
        }

        // === CATCH-ALL -- any file in game directory or config directory ===
        if (GAME_DIR_PATTERN.test(filePath)) {
          return makeOverride(
            "ask",
            `Editing file in game/config directory: ${filePath}`
          );
        }
      } catch {
        // Fail open — never block legitimate file edits on error
      }
    },
  };
};
