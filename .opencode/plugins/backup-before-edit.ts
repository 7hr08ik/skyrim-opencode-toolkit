// backup-before-edit.ts
// Auto-backup any file before it is edited or written.
// Saves to .opencode/backups/ with timestamp and logs to audit trail.
//
// Replaces: .opencode/hooks/backup-before-edit.sh

const BACKUP_DIR = ".opencode/backups";
const AUDIT_LOG = "AUDIT_LOG.txt";

// File patterns to skip (our own transient workspace files)
const SKIP_PATTERNS = [
  /\.opencode\/backups\//,
  /\.opencode\/hooks\//,
  /\.opencode\/plans\//,
  /node_modules\//,
];

function shouldSkip(filePath: string): boolean {
  return SKIP_PATTERNS.some((p) => p.test(filePath));
}

function safeName(filePath: string): string {
  return filePath.replace(/[/\\:]/g, "_").replace(/^_+/, "");
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

export const BackupBeforeEdit = async (context: any) => {
  return {
    event: async ({ event }: { event: any }) => {
      try {
        if (event.type !== "tool.execute.before") return;

        const data = event.data || {};
        const toolName = data.tool_name || "unknown";
        const filePath = data.tool_input?.file_path;

        // Only applies to Edit/Write tools that have a file path
        if (
          toolName !== "Edit" &&
          toolName !== "Write" &&
          toolName !== "WriteFile" &&
          toolName !== "MultiEdit"
        ) {
          return;
        }

        if (!filePath) return;
        if (shouldSkip(filePath)) return;

        const projectDir = context.directory || "";
        const backupDir = `${projectDir}/${BACKUP_DIR}`;
        const timestamp = new Date()
          .toISOString()
          .replace(/[:.]/g, "")
          .slice(0, 15); // YYYYMMDD_HHMMSS
        const safe = safeName(filePath);
        const backupPath = `${backupDir}/${timestamp}__${safe}`;

        // Create backup directory and copy file
        await context.$`mkdir -p ${backupDir}`;
        await context.$`cp "${filePath}" "${backupPath}" 2>/dev/null || true`;

        // Append audit log entry
        const auditEntry = `[${timestamp}] ${toolName} -> ${filePath} (backup: ${timestamp}__${safe})\n`;
        await context.$`echo ${auditEntry} >> "${projectDir}/${BACKUP_DIR}/${AUDIT_LOG}"`;
      } catch {
        // Fail silently — backup is a safety net, not a blocker
      }
    },
  };
};
