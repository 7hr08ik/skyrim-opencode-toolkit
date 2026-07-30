// Tests for backup-before-edit.ts
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, existsSync, mkdirSync, readFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BackupBeforeEdit } from "../plugins/backup-before-edit.js";

// ---------------------------------------------------------------------------
// Pure function tests
// ---------------------------------------------------------------------------

describe("backup-before-edit — pure functions", () => {
  // Import the module to access inner functions via re-export
  // Since the module doesn't export them directly, we test via the plugin
  // factory + a spy on context.$ to verify behavior.
});

// ---------------------------------------------------------------------------
// Helper: build a mock context that records shell calls
// ---------------------------------------------------------------------------

function createMockContext(projectDir: string) {
  const calls: Array<{ cmd: string; args: string[] }> = [];

  const mock$ = async (strings: TemplateStringsArray, ...values: any[]) => {
    // Reconstruct the command string
    let cmd = strings[0];
    for (let i = 0; i < values.length; i++) {
      cmd += String(values[i]) + strings[i + 1];
    }
    calls.push({ cmd, args: values.map(String) });

    // Handle mkdir -p
    if (cmd.includes("mkdir -p")) {
      const dirMatch = cmd.match(/mkdir -p (.+)/);
      if (dirMatch) {
        const dir = dirMatch[1].replace(/"/g, "");
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }
      }
      return { stdout: "" };
    }

    // Handle cp
    if (cmd.includes("cp ")) {
      // Match cp "src" "dst" — extract the two quoted paths
      const quotedMatch = cmd.match(/cp\s+"([^"]+)"\s+"([^"]+)"/);
      if (quotedMatch) {
        const src = quotedMatch[1];
        const dst = quotedMatch[2];
        if (existsSync(src)) {
          const dstDir = dst.substring(0, dst.lastIndexOf("/"));
          if (!existsSync(dstDir)) {
            mkdirSync(dstDir, { recursive: true });
          }
          cpSync(src, dst);
        }
      } else {
        // Fallback: cp src dst (unquoted)
        const unquotedMatch = cmd.match(/cp\s+(\S+)\s+(\S+)/);
        if (unquotedMatch) {
          const src = unquotedMatch[1];
          const dst = unquotedMatch[2];
          if (existsSync(src)) {
            const dstDir = dst.substring(0, dst.lastIndexOf("/"));
            if (!existsSync(dstDir)) {
              mkdirSync(dstDir, { recursive: true });
            }
            cpSync(src, dst);
          }
        }
      }
      return { stdout: "" };
    }

    // Handle echo >> (append)
    if (cmd.includes(">>")) {
      // The audit entry contains a \n, so the command spans two "lines"
      // Match: echo <content> >> "<file>"
      const appendMatch = cmd.match(/echo\s+(.+?)\s+>>\s*"([^"]+)"/s);
      if (appendMatch) {
        const content = appendMatch[1].replace(/\n/g, "");
        const file = appendMatch[2];
        const dir = file.substring(0, file.lastIndexOf("/"));
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }
        writeFileSync(file, content, { flag: "a" });
      }
      return { stdout: "" };
    }

    return { stdout: "" };
  };

  return {
    context: { directory: projectDir, $: mock$ },
    calls,
  };
}

// ---------------------------------------------------------------------------
// Plugin integration tests
// ---------------------------------------------------------------------------

describe("backup-before-edit — plugin", () => {
  let projectDir: string;

  before(() => {
    projectDir = mkdtempSync(join(tmpdir(), "backup-test-"));
    writeFileSync(join(projectDir, "test.txt"), "hello world");
  });

  after(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("returns event handler from factory", async () => {
    const { context } = createMockContext(projectDir);
    const plugin = await BackupBeforeEdit(context);
    assert.ok(plugin);
    assert.ok(plugin.event);
    assert.equal(typeof plugin.event, "function");
  });

  it("does nothing for non-tool events", async () => {
    const { context, calls } = createMockContext(projectDir);
    const plugin = await BackupBeforeEdit(context);
    await plugin.event!({ event: { type: "other.event" } });
    assert.equal(calls.length, 0);
  });

  it("does nothing for non-edit tools (Bash, Read, etc.)", async () => {
    const { context, calls } = createMockContext(projectDir);
    const plugin = await BackupBeforeEdit(context);

    await plugin.event!({
      event: {
        type: "tool.execute.before",
        data: { tool_name: "Bash", tool_input: { command: "ls" } },
      },
    });
    await plugin.event!({
      event: {
        type: "tool.execute.before",
        data: { tool_name: "Read", tool_input: { file_path: "x" } },
      },
    });
    assert.equal(calls.length, 0);
  });

  it("does nothing when no file_path is provided", async () => {
    const { context, calls } = createMockContext(projectDir);
    const plugin = await BackupBeforeEdit(context);

    await plugin.event!({
      event: {
        type: "tool.execute.before",
        data: { tool_name: "Edit", tool_input: {} },
      },
    });
    assert.equal(calls.length, 0);
  });

  it("skips files in backup directory", async () => {
    const { context, calls } = createMockContext(projectDir);
    const plugin = await BackupBeforeEdit(context);

    await plugin.event!({
      event: {
        type: "tool.execute.before",
        data: {
          tool_name: "Edit",
          tool_input: { file_path: "/some/path/.opencode/backups/file.txt" },
        },
      },
    });
    assert.equal(calls.length, 0);
  });

  it("skips files in hooks directory", async () => {
    const { context, calls } = createMockContext(projectDir);
    const plugin = await BackupBeforeEdit(context);

    await plugin.event!({
      event: {
        type: "tool.execute.before",
        data: {
          tool_name: "Edit",
          tool_input: { file_path: "/some/path/.opencode/hooks/script.sh" },
        },
      },
    });
    assert.equal(calls.length, 0);
  });

  it("skips files in plans directory", async () => {
    const { context, calls } = createMockContext(projectDir);
    const plugin = await BackupBeforeEdit(context);

    await plugin.event!({
      event: {
        type: "tool.execute.before",
        data: {
          tool_name: "Edit",
          tool_input: { file_path: "/some/path/.opencode/plans/plan.md" },
        },
      },
    });
    assert.equal(calls.length, 0);
  });

  it("skips files in node_modules", async () => {
    const { context, calls } = createMockContext(projectDir);
    const plugin = await BackupBeforeEdit(context);

    await plugin.event!({
      event: {
        type: "tool.execute.before",
        data: {
          tool_name: "Edit",
          tool_input: { file_path: "/some/path/node_modules/pkg/index.js" },
        },
      },
    });
    assert.equal(calls.length, 0);
  });

  it("creates backup and audit log for Edit tool", async () => {
    const { context, calls } = createMockContext(projectDir);
    const plugin = await BackupBeforeEdit(context);

    await plugin.event!({
      event: {
        type: "tool.execute.before",
        data: {
          tool_name: "Edit",
          tool_input: { file_path: join(projectDir, "test.txt") },
        },
      },
    });

    // Should have: mkdir + cp + echo audit
    assert.ok(calls.length >= 2, `Expected at least 2 calls, got ${calls.length}`);

    // Verify mkdir was called for backup dir
    const mkdirCall = calls.find((c) => c.cmd.includes("mkdir -p"));
    assert.ok(mkdirCall, "Expected mkdir call for backup directory");
    assert.ok(mkdirCall!.cmd.includes(".opencode/backups"));

    // Verify cp was called
    const cpCall = calls.find((c) => c.cmd.includes("cp "));
    assert.ok(cpCall, "Expected cp call for backup");
    assert.ok(cpCall!.cmd.includes("test.txt"));

    // Verify audit log entry was written
    const echoCall = calls.find((c) => c.cmd.includes(">>"));
    assert.ok(echoCall, "Expected echo call for audit log");
    assert.ok(echoCall!.cmd.includes("AUDIT_LOG.txt"));
    assert.ok(echoCall!.cmd.includes("Edit"));
    assert.ok(echoCall!.cmd.includes("test.txt"));

    // Verify backup file was actually created on disk
    const backupFiles = calls
      .find((c) => c.cmd.includes("cp "))!
      .cmd.match(/cp "([^"]+)" "([^"]+)"/);
    if (backupFiles) {
      const backupPath = backupFiles[2];
      assert.ok(existsSync(backupPath), `Backup file should exist at ${backupPath}`);
      assert.equal(
        readFileSync(backupPath, "utf-8"),
        "hello world",
        "Backup content should match original"
      );
    }
  });

  it("creates backup for Write tool", async () => {
    const { context, calls } = createMockContext(projectDir);
    const plugin = await BackupBeforeEdit(context);

    await plugin.event!({
      event: {
        type: "tool.execute.before",
        data: {
          tool_name: "Write",
          tool_input: { file_path: join(projectDir, "test.txt") },
        },
      },
    });

    const cpCall = calls.find((c) => c.cmd.includes("cp "));
    assert.ok(cpCall, "Expected cp call for Write tool");
  });

  it("creates backup for WriteFile tool", async () => {
    const { context, calls } = createMockContext(projectDir);
    const plugin = await BackupBeforeEdit(context);

    await plugin.event!({
      event: {
        type: "tool.execute.before",
        data: {
          tool_name: "WriteFile",
          tool_input: { file_path: join(projectDir, "test.txt") },
        },
      },
    });

    const cpCall = calls.find((c) => c.cmd.includes("cp "));
    assert.ok(cpCall, "Expected cp call for WriteFile tool");
  });

  it("creates backup for MultiEdit tool", async () => {
    const { context, calls } = createMockContext(projectDir);
    const plugin = await BackupBeforeEdit(context);

    await plugin.event!({
      event: {
        type: "tool.execute.before",
        data: {
          tool_name: "MultiEdit",
          tool_input: { file_path: join(projectDir, "test.txt") },
        },
      },
    });

    const cpCall = calls.find((c) => c.cmd.includes("cp "));
    assert.ok(cpCall, "Expected cp call for MultiEdit tool");
  });

  it("includes tool name in audit log entry", async () => {
    const { context, calls } = createMockContext(projectDir);
    const plugin = await BackupBeforeEdit(context);

    await plugin.event!({
      event: {
        type: "tool.execute.before",
        data: {
          tool_name: "Edit",
          tool_input: { file_path: join(projectDir, "myfile.txt") },
        },
      },
    });

    const echoCall = calls.find((c) => c.cmd.includes(">>"));
    assert.ok(echoCall);
    assert.match(echoCall!.cmd, /Edit/);
    assert.match(echoCall!.cmd, /myfile\.txt/);
  });

  it("uses safe name (replaces special chars) in backup filename", async () => {
    const { context, calls } = createMockContext(projectDir);
    const plugin = await BackupBeforeEdit(context);

    const filePath = "C:/Users/Test/My File.txt";
    await plugin.event!({
      event: {
        type: "tool.execute.before",
        data: {
          tool_name: "Edit",
          tool_input: { file_path: filePath },
        },
      },
    });

    const cpCall = calls.find((c) => c.cmd.includes("cp "));
    assert.ok(cpCall, "Should have a cp call");
    // safeName replaces / \ : with _ and strips leading _
    // C:/Users/Test/My File.txt -> C__Users_Test_My File.txt -> C_Users_Test_My File.txt
    // The exact output depends on implementation; verify special chars are replaced
    assert.ok(
      cpCall!.cmd.includes("Users") && cpCall!.cmd.includes("Test") && cpCall!.cmd.includes("My File.txt"),
      `Expected path components in cp call, got: ${cpCall!.cmd}`
    );
    // Verify no raw / or : in the backup filename portion (after the backup dir)
    const backupPathMatch = cpCall!.cmd.match(/backups\/([^"]+)"/);
    assert.ok(backupPathMatch, "Should have backup path in cp call");
    const backupFileName = backupPathMatch![1];
    assert.ok(!backupFileName.includes("/"), `Backup filename should not contain /: ${backupFileName}`);
    assert.ok(!backupFileName.includes(":"), `Backup filename should not contain :: ${backupFileName}`);
  });
});
