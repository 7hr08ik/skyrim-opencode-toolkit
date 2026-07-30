// protect-bash.ts
// Protect against destructive or file-modifying bash commands in Skyrim modding environment.
//
// Replaces: .opencode/hooks/protect-bash.sh
//
// Hard blocks:
//   - Deleting the game installation directory
//   - Deleting Skyrim config directory
//   - Deleting Bethesda registry keys
//
// Requires confirmation for:
//   - rm in game directory
//   - mv/cp/move/copy to/from game/config directories
//   - Output redirection to game/config directories
//   - In-place sed edits in game/config directories
//   - Plugin/archive file references
//   - Load order file references
//   - AutoMod ESP/NIF/Archive write commands (unless --dry-run)

function makeOverride(decision: "deny" | "ask", reason: string) {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: decision,
      permissionDecisionReason: reason,
    },
  };
}

const HARD_DENY: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern:
      /rm\s+(-[a-z]*\s+)?(-[a-z]*\s+)?["']?(C:\/|\/c\/).*Documents\/My Games\/Skyrim/i,
    reason: "BLOCKED: Cannot delete the Skyrim config directory.",
  },
  {
    pattern:
      /rm\s+(-[a-z]*\s+)?(-[a-z]*\s+)?["']?(C:\/|\/c\/).*Skyrim/i,
    reason: "BLOCKED: Cannot delete the game installation directory.",
  },
  {
    pattern: /(reg\s+delete|Remove-ItemProperty.*Bethesda)/i,
    reason: "BLOCKED: Cannot delete Bethesda registry keys.",
  },
];

const CONFIRM_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /rm\s.*(Skyrim|Data\/)/i,
    reason: (cmd: string) => `Deleting files in game directory -- confirm: ${cmd}`,
  },
  {
    pattern:
      /(mv|cp|move|copy)\s.*(Skyrim|Data\/|My Games\/Skyrim)/i,
    reason: (cmd: string) =>
      `Moving/copying files in game directory -- confirm: ${cmd}`,
  },
  {
    pattern: />\s*["']?(C:\/|\/c\/).*Skyrim/i,
    reason: (cmd: string) =>
      `Redirecting output to game/config directory -- confirm: ${cmd}`,
  },
  {
    pattern: /sed\s+-i.*(Skyrim|Data\/|My Games\/Skyrim)/i,
    reason: (cmd: string) =>
      `In-place edit in game directory -- confirm: ${cmd}`,
  },
  {
    pattern: /\.(esp|esm|esl|bsa|ba2)\b/i,
    reason: (cmd: string) =>
      `Command references plugin/archive files -- confirm: ${cmd}`,
  },
  {
    pattern: /(loadorder\.txt|plugins\.txt)/i,
    reason: (cmd: string) =>
      `Command references load order -- confirm: ${cmd}`,
  },
];

const AUTOMOD_ESP_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern:
      /(automod|SpookysAutomod).*\b(add-weapon|add-spell|add-armor|add-npc|add-quest|add-perk|add-book|add-global|add-faction|add-leveled-item|add-form-list|add-encounter-zone|add-location|add-outfit|attach-script|set-property|auto-fill|merge|generate-seq)\b/i,
    reason: "AutoMod ESP write command without --dry-run -- confirm: ",
  },
];

const AUTOMOD_NIF_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern:
      /(automod|SpookysAutomod).*\b(replace-textures|rename-strings|fix-eyes|scale)\b/i,
    reason: "AutoMod NIF write command -- confirm: ",
  },
];

const AUTOMOD_ARCHIVE_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern:
      /(automod|SpookysAutomod).*\b(archive\s+(create|add-files|remove-files|replace-files|update-file|merge|optimize))\b/i,
    reason: "AutoMod archive write command -- confirm: ",
  },
];

export const ProtectBash = async (context: any) => {
  return {
    event: async ({ event }: { event: any }) => {
      try {
        if (event.type !== "tool.execute.before") return;

        const data = event.data || {};
        const toolName = data.tool_name || "";

        // Only applies to Bash tool
        if (toolName !== "Bash" && toolName !== "bash") return;

        const command = data.tool_input?.command || "";
        if (!command) return;

        // === HARD DENY ===
        for (const { pattern, reason } of HARD_DENY) {
          if (pattern.test(command)) {
            return makeOverride("deny", reason);
          }
        }

        // === AutoMod ESP writes (confirm unless --dry-run) ===
        // Must check BEFORE generic .esp pattern below
        for (const { pattern, reason } of AUTOMOD_ESP_PATTERNS) {
          if (pattern.test(command)) {
            if (!/\-\-dry-run/.test(command)) {
              return makeOverride("ask", reason + command);
            }
            // --dry-run present: skip (no confirmation needed)
            return;
          }
        }

        // === AutoMod NIF writes (always confirm) ===
        for (const { pattern, reason } of AUTOMOD_NIF_PATTERNS) {
          if (pattern.test(command)) {
            return makeOverride("ask", reason + command);
          }
        }

        // === AutoMod Archive writes (always confirm) ===
        for (const { pattern, reason } of AUTOMOD_ARCHIVE_PATTERNS) {
          if (pattern.test(command)) {
            return makeOverride("ask", reason + command);
          }
        }

        // === CONFIRM (generic patterns — checked after AutoMod-specific) ===
        for (const { pattern, reason } of CONFIRM_PATTERNS) {
          if (pattern.test(command)) {
            const msg =
              typeof reason === "function" ? reason(command) : reason;
            return makeOverride("ask", msg);
          }
        }
      } catch {
        // Fail open — never block legitimate commands on error
      }
    },
  };
};
