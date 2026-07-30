// snapshot-before-tool.ts
// Auto-snapshot active .psc/.pex files before every Bash command.
//
// Rationale: backup-before-edit.sh only fires for Edit/Write tool calls.
// External tools invoked via Bash (AutoMod, PapyrusAssembler, Champollion,
// Caprica, Spriggit, and unknown future tools) bypass that hook entirely.
// Some tools (e.g. a failed decompile) silently destroy their output files.
// We can't reliably classify which commands are "risky", so we snapshot before
// every Bash command. Files are small, snapshots are fast, and a rate limit
// prevents spam during command bursts.
//
// Replaces: .opencode/hooks/snapshot-before-tool.sh

const SNAPSHOT_BASE = ".opencode/backups/auto_snapshots";
const SOURCE_DIR = "Data/Scripts/Source";
const DEPLOY_DIR = "Data/Scripts";
const RATE_LIMIT_SECONDS = 60;
const PSC_MTIME_DAYS = 7;
const PRUNE_DAYS = 14;

// Purely informational commands that can't write files
const INFO_COMMANDS =
  /^\s*(ls|cat|head|tail|grep|find|wc|file|stat|pwd|echo|date|whoami|which|type|env|printenv)(\s|$)/;
const INFO_GIT =
  /^\s*git\s+(status|log|diff|show|branch|remote|config\s+--get)/;

function isInfoCommand(command: string): boolean {
  return INFO_COMMANDS.test(command) || INFO_GIT.test(command);
}

function makeOverride(decision: "deny" | "ask", reason: string) {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: decision,
      permissionDecisionReason: reason,
    },
  };
}

export const SnapshotBeforeTool = async (context: any) => {
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

        // Skip purely informational commands
        if (isInfoCommand(command)) return;

        const projectDir = context.directory || "";
        const snapshotBase = `${projectDir}/${SNAPSHOT_BASE}`;
        const sourceDir = `${projectDir}/${SOURCE_DIR}`;
        const deployDir = `${projectDir}/${DEPLOY_DIR}`;
        const rateLimitFile = `${snapshotBase}/.last_snapshot`;

        // Skip if source directory doesn't exist (no Papyrus dev)
        try {
          await context.$`test -d ${sourceDir}`;
        } catch {
          return;
        }

        // Rate limit: skip if snapshotted within last N seconds AND no .psc
        // has been modified since the last snapshot.
        try {
          const stat = await context.$`stat -c %s ${rateLimitFile}`;
          const lastEpoch = parseInt(stat.stdout?.trim() || "0", 10);
          const now = Math.floor(Date.now() / 1000);
          const age = now - lastEpoch;

          if (age < RATE_LIMIT_SECONDS) {
            const result = await context.$`find ${sourceDir} -maxdepth 1 -name "*.psc" -newer ${rateLimitFile} -type f 2>/dev/null | head -1`;
            if (!result.stdout?.trim()) return;
          }
        } catch {
          // No rate limit file yet — proceed with snapshot
        }

        const timestamp = new Date()
          .toISOString()
          .replace(/[:.]/g, "")
          .slice(0, 15);
        const snapshotDir = `${snapshotBase}/${timestamp}`;

        await context.$`mkdir -p ${snapshotDir}/source ${snapshotDir}/deploy`;

        // Snapshot .psc files modified in last 7 days
        try {
          await context.$`find ${sourceDir} -maxdepth 1 -name "*.psc" -mtime -${PSC_MTIME_DAYS} -type f -exec cp {{}} ${snapshotDir}/source/ \\; 2>/dev/null`;
        } catch {
          // Source dir may be empty or inaccessible
        }

        // Snapshot .pex files modified in last 7 days
        try {
          await context.$`test -d ${deployDir} && find ${deployDir} -maxdepth 1 -name "*.pex" -mtime -${PSC_MTIME_DAYS} -type f -exec cp {{}} ${snapshotDir}/deploy/ \\; 2>/dev/null`;
        } catch {
          // Deploy dir may not exist
        }

        // Count files
        const pscResult = await context.$`ls ${snapshotDir}/source/ 2>/dev/null | wc -l`;
        const pexResult = await context.$`ls ${snapshotDir}/deploy/ 2>/dev/null | wc -l`;
        const pscCount = parseInt(pscResult.stdout?.trim() || "0", 10);
        const pexCount = parseInt(pexResult.stdout?.trim() || "0", 10);

        // Clean up empty snapshot dirs
        if (pscCount === 0 && pexCount === 0) {
          await context.$`rm -rf ${snapshotDir}`;
          return;
        }

        // Update rate-limit timestamp
        await context.$`date +%s > ${rateLimitFile}`;

        // Log to audit trail
        const shortCmd = command.slice(0, 120);
        const auditEntry = `[${timestamp}] AUTO-SNAPSHOT (psc:${pscCount} pex:${pexCount}) before: ${shortCmd}\n`;
        await context.$`echo ${auditEntry} >> "${projectDir}/.opencode/backups/AUDIT_LOG.txt"`;

        // Prune snapshots older than 14 days
        try {
          await context.$`find ${snapshotBase} -maxdepth 1 -type d -mtime +${PRUNE_DAYS} ! -name ".last_snapshot" -exec rm -rf {{}} \\; 2>/dev/null`;
        } catch {
          // Best effort cleanup
        }
      } catch {
        // Fail silently — snapshot is a safety net, not a blocker
      }
    },
  };
};
