// Tests for snapshot-before-tool.ts
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  existsSync,
  mkdirSync,
  cpSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SnapshotBeforeTool } from "../plugins/snapshot-before-tool.js";

// ---------------------------------------------------------------------------
// Helper: build a mock context with filesystem simulation
// ---------------------------------------------------------------------------

function createMockContext(projectDir: string) {
  const calls: Array<{ cmd: string }> = [];

  const mock$ = async (strings: TemplateStringsArray, ...values: any[]) => {
    let cmd = strings[0];
    for (let i = 0; i < values.length; i++) {
      cmd += String(values[i]) + strings[i + 1];
    }
    calls.push({ cmd });

    // Handle mkdir -p (may have multiple dirs: "mkdir -p dir1 dir2")
    const mkdirMatch = cmd.match(/mkdir -p (.+)/);
    if (mkdirMatch) {
      const dirs = mkdirMatch[1].split(/\s+/);
      for (const dir of dirs) {
        const d = dir.replace(/"/g, "");
        if (!existsSync(d)) {
          mkdirSync(d, { recursive: true });
        }
      }
      return { stdout: "" };
    }

    // Handle test -d
    if (cmd.startsWith("test -d")) {
      const dirMatch = cmd.match(/test -d (.+)/);
      if (dirMatch) {
        const dir = dirMatch[1].replace(/"/g, "");
        if (!existsSync(dir)) {
          throw new Error("Directory not found");
        }
      }
      return { stdout: "" };
    }

    // Handle find ... -exec cp {{}} <destDir> — copy matching files
    // Note: JS template literals produce {{}} literally (not {})
    const findExecCpMatch = cmd.match(
      /find\s+(\S+)\s+.*-exec\s+cp\s+\{\{\}\}\s+(\S+)/
    );
    if (findExecCpMatch) {
      const srcDir = findExecCpMatch[1].replace(/"/g, "");
      const destDir = findExecCpMatch[2].replace(/"/g, "");
      if (existsSync(srcDir) && existsSync(destDir)) {
        const entries = rmSync ? [] : readdirSync(srcDir);
        // Actually use fs.readdirSync
        const allEntries = readdirSync(srcDir);
        for (const entry of allEntries) {
          const srcFile = join(srcDir, entry);
          if (existsSync(srcFile) && statSync(srcFile).isFile()) {
            cpSync(srcFile, join(destDir, entry));
          }
        }
      }
      return { stdout: "" };
    }

    // Handle date +%s
    if (cmd.includes("date +%s")) {
      const writeMatch = cmd.match(/date +%s > (.+)/);
      if (writeMatch) {
        const file = writeMatch[1].replace(/"/g, "");
        const dir = file.substring(0, file.lastIndexOf("/"));
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }
        writeFileSync(file, String(Math.floor(Date.now() / 1000)));
      }
      return { stdout: String(Math.floor(Date.now() / 1000)) };
    }

    // Handle stat -c %s
    if (cmd.includes("stat -c %s")) {
      const fileMatch = cmd.match(/stat -c %s (.+)/);
      if (fileMatch) {
        const file = fileMatch[1].replace(/"/g, "");
        if (existsSync(file)) {
          return { stdout: readFileSync(file, "utf-8").trim() };
        }
        throw new Error("File not found");
      }
      return { stdout: "0" };
    }

    // Handle find with -newer
    if (cmd.includes("-newer")) {
      return { stdout: "" }; // No newer files in test
    }

    // Handle ls | wc -l — count actual files
    if (cmd.includes("wc -l")) {
      // Extract the directory from "ls <dir> ... | wc -l"
      const dirMatch = cmd.match(/\bls\s+(\S+)/);
      if (dirMatch) {
        const dir = dirMatch[1].replace(/"/g, "");
        if (existsSync(dir)) {
          const files = readdirSync(dir).filter((f) => !f.startsWith("."));
          return { stdout: String(files.length) };
        }
      }
      return { stdout: "0" };
    }

    // Handle echo >> (append) — handle multi-line content
    if (cmd.includes(">>")) {
      // Match: echo <content> >> "<file>"  (content may contain newlines)
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

    // Handle rm -rf
    if (cmd.includes("rm -rf")) {
      const dirMatch = cmd.match(/rm -rf (.+)/);
      if (dirMatch) {
        const dir = dirMatch[1].replace(/"/g, "");
        if (existsSync(dir)) {
          rmSync(dir, { recursive: true, force: true });
        }
      }
      return { stdout: "" };
    }

    // Handle find ... -exec rm -rf (prune)
    if (cmd.includes("find") && cmd.includes("rm -rf")) {
      return { stdout: "" };
    }

    return { stdout: "" };
  };

  return {
    context: { directory: projectDir, $: mock$ },
    calls,
  };
}

function makeEvent(toolName: string, command: string) {
  return {
    event: {
      type: "tool.execute.before",
      data: { tool_name: toolName, tool_input: { command } },
    },
  };
}

// ---------------------------------------------------------------------------
// Plugin factory test
// ---------------------------------------------------------------------------

describe("snapshot-before-tool — plugin factory", () => {
  it("returns event handler from factory", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "snapshot-test-"));
    const { context } = createMockContext(projectDir);
    const plugin = await SnapshotBeforeTool(context);
    assert.ok(plugin);
    assert.ok(plugin.event);
    assert.equal(typeof plugin.event, "function");
    rmSync(projectDir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// Info command skip tests
// ---------------------------------------------------------------------------

describe("snapshot-before-tool — info command skipping", () => {
  let projectDir: string;
  let sourceDir: string;

  before(() => {
    projectDir = mkdtempSync(join(tmpdir(), "snapshot-test-"));
    sourceDir = join(projectDir, "Data", "Scripts", "Source");
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(join(sourceDir, "Test.psc"), "// test");
  });

  after(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  const infoCommands = [
    "ls Data/",
    "cat file.txt",
    "head -n 10 file.txt",
    "tail -n 5 file.txt",
    "grep pattern file.txt",
    "find . -name '*.txt'",
    "wc -l file.txt",
    "file somefile.nif",
    "stat file.txt",
    "pwd",
    "echo hello",
    "date",
    "whoami",
    "which bash",
    "type ls",
    "env",
    "printenv PATH",
  ];

  for (const cmd of infoCommands) {
    it(`skips informational command: ${cmd}`, async () => {
      const { context, calls } = createMockContext(projectDir);
      const plugin = await SnapshotBeforeTool(context);
      await plugin.event!(makeEvent("Bash", cmd));
      // Should not have made any snapshot-related calls
      const snapshotCalls = calls.filter(
        (c) =>
          c.cmd.includes("find") &&
          (c.cmd.includes(".psc") || c.cmd.includes("source"))
      );
      assert.equal(
        snapshotCalls.length,
        0,
        `Should not snapshot for info command: ${cmd}`
      );
    });
  }

  const infoGitCommands = [
    "git status",
    "git log",
    "git diff",
    "git show",
    "git branch",
    "git remote",
    "git config --get user.name",
  ];

  for (const cmd of infoGitCommands) {
    it(`skips informational git command: ${cmd}`, async () => {
      const { context, calls } = createMockContext(projectDir);
      const plugin = await SnapshotBeforeTool(context);
      await plugin.event!(makeEvent("Bash", cmd));
      const snapshotCalls = calls.filter(
        (c) =>
          c.cmd.includes("find") &&
          (c.cmd.includes(".psc") || c.cmd.includes("source"))
      );
      assert.equal(
        snapshotCalls.length,
        0,
        `Should not snapshot for info git command: ${cmd}`
      );
    });
  }
});

// ---------------------------------------------------------------------------
// Non-Bash tool filtering
// ---------------------------------------------------------------------------

describe("snapshot-before-tool — non-Bash tool filtering", () => {
  let projectDir: string;
  let sourceDir: string;

  before(() => {
    projectDir = mkdtempSync(join(tmpdir(), "snapshot-test-"));
    sourceDir = join(projectDir, "Data", "Scripts", "Source");
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(join(sourceDir, "Test.psc"), "// test");
  });

  after(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("does nothing for Edit tool events", async () => {
    const { context, calls } = createMockContext(projectDir);
    const plugin = await SnapshotBeforeTool(context);
    await plugin.event!(
      makeEvent("Edit", "Data/Scripts/Source/Test.psc")
    );
    assert.equal(calls.length, 0);
  });

  it("does nothing for Read tool events", async () => {
    const { context, calls } = createMockContext(projectDir);
    const plugin = await SnapshotBeforeTool(context);
    await plugin.event!(
      makeEvent("Read", "Data/Scripts/Source/Test.psc")
    );
    assert.equal(calls.length, 0);
  });

  it("handles non-Bash tool names", async () => {
    const { context, calls } = createMockContext(projectDir);
    const plugin = await SnapshotBeforeTool(context);
    await plugin.event!(makeEvent("Write", "some file"));
    assert.equal(calls.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Missing source directory test
// ---------------------------------------------------------------------------

describe("snapshot-before-tool — missing source directory", () => {
  it("does nothing when source directory doesn't exist", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "snapshot-test-"));
    const { context, calls } = createMockContext(projectDir);
    const plugin = await SnapshotBeforeTool(context);

    // No Data/Scripts/Source directory created
    await plugin.event!(makeEvent("Bash", "automod nif info mesh.nif"));

    // Should not have attempted any snapshot operations
    const snapshotCalls = calls.filter((c) => c.cmd.includes("find"));
    assert.equal(
      snapshotCalls.length,
      0,
      "Should not attempt snapshot when source dir missing"
    );
    rmSync(projectDir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// Rate limit test
// ---------------------------------------------------------------------------

describe("snapshot-before-tool — rate limiting", () => {
  let projectDir: string;
  let sourceDir: string;
  let snapshotBase: string;
  let rateLimitFile: string;

  before(() => {
    projectDir = mkdtempSync(join(tmpdir(), "snapshot-test-"));
    sourceDir = join(projectDir, "Data", "Scripts", "Source");
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(join(sourceDir, "Test.psc"), "// test");

    snapshotBase = join(projectDir, ".opencode", "backups", "auto_snapshots");
    rateLimitFile = join(snapshotBase, ".last_snapshot");
    mkdirSync(snapshotBase, { recursive: true });
    // Write a timestamp from 30 seconds ago
    const pastTime = Math.floor(Date.now() / 1000) - 30;
    writeFileSync(rateLimitFile, String(pastTime));
  });

  after(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("skips snapshot when rate limited and no new .psc files", async () => {
    const { context, calls } = createMockContext(projectDir);
    const plugin = await SnapshotBeforeTool(context);
    await plugin.event!(makeEvent("Bash", "automod nif info mesh.nif"));

    // Should have checked the rate limit file but not created a snapshot
    const mkdirCalls = calls.filter((c) => c.cmd.includes("mkdir -p"));
    // The mkdir for snapshot dirs should NOT have been called
    // (the rate limit check happens before mkdir)
    const snapshotMkdir = mkdirCalls.find((c) =>
      c.cmd.includes("auto_snapshots")
    );
    assert.equal(
      snapshotMkdir,
      undefined,
      "Should not create snapshot dirs when rate limited with no changes"
    );
  });
});

// ---------------------------------------------------------------------------
// Actual snapshot test (with mocked filesystem)
// ---------------------------------------------------------------------------

describe("snapshot-before-tool — snapshot creation", () => {
  let projectDir: string;
  let sourceDir: string;
  let deployDir: string;

  before(() => {
    projectDir = mkdtempSync(join(tmpdir(), "snapshot-test-"));
    sourceDir = join(projectDir, "Data", "Scripts", "Source");
    deployDir = join(projectDir, "Data", "Scripts");
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(deployDir, { recursive: true });

    // Create .psc files
    writeFileSync(join(sourceDir, "TestScript.psc"), "// test script");
    writeFileSync(join(sourceDir, "AnotherScript.psc"), "// another");

    // Create .pex files
    writeFileSync(join(deployDir, "TestScript.pex"), "// compiled");
    writeFileSync(join(deployDir, "AnotherScript.pex"), "// compiled 2");
  });

  after(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("creates snapshot directories for Bash commands", async () => {
    const { context, calls } = createMockContext(projectDir);
    const plugin = await SnapshotBeforeTool(context);
    await plugin.event!(makeEvent("Bash", "automod nif info mesh.nif"));

    // Should have created snapshot dirs
    const mkdirCalls = calls.filter((c) => c.cmd.includes("mkdir -p"));
    const snapshotMkdir = mkdirCalls.find((c) =>
      c.cmd.includes("auto_snapshots")
    );
    assert.ok(
      snapshotMkdir,
      "Should create snapshot directories"
    );
  });

  it("writes audit log entry", async () => {
    const { context, calls } = createMockContext(projectDir);
    const plugin = await SnapshotBeforeTool(context);
    await plugin.event!(makeEvent("Bash", "automod nif info mesh.nif"));

    const echoCalls = calls.filter((c) => c.cmd.includes(">>"));
    const auditCall = echoCalls.find((c) =>
      c.cmd.includes("AUDIT_LOG.txt")
    );
    assert.ok(
      auditCall,
      "Should write audit log entry"
    );
    assert.ok(
      auditCall!.cmd.includes("AUTO-SNAPSHOT"),
      "Audit entry should mention AUTO-SNAPSHOT"
    );
    assert.ok(
      auditCall!.cmd.includes("automod nif info mesh.nif"),
      "Audit entry should include the command"
    );
  });

  it("does not snapshot for Bash with empty command", async () => {
    const { context, calls } = createMockContext(projectDir);
    const plugin = await SnapshotBeforeTool(context);
    await plugin.event!(makeEvent("Bash", ""));
    const snapshotCalls = calls.filter((c) => c.cmd.includes("find"));
    assert.equal(snapshotCalls.length, 0);
  });

  it("does not snapshot for Bash with missing command", async () => {
    const { context, calls } = createMockContext(projectDir);
    const plugin = await SnapshotBeforeTool(context);
    await plugin.event!({
      event: {
        type: "tool.execute.before",
        data: { tool_name: "Bash", tool_input: {} },
      },
    });
    const snapshotCalls = calls.filter((c) => c.cmd.includes("find"));
    assert.equal(snapshotCalls.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("snapshot-before-tool — edge cases", () => {
  let projectDir: string;
  let sourceDir: string;

  before(() => {
    projectDir = mkdtempSync(join(tmpdir(), "snapshot-test-"));
    sourceDir = join(projectDir, "Data", "Scripts", "Source");
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(join(sourceDir, "Test.psc"), "// test");
  });

  after(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("handles non-tool events gracefully", async () => {
    const { context, calls } = createMockContext(projectDir);
    const plugin = await SnapshotBeforeTool(context);
    await plugin.event!({ event: { type: "other.event" } });
    assert.equal(calls.length, 0);
  });

  it("handles case-insensitive 'bash' tool name", async () => {
    const { context, calls } = createMockContext(projectDir);
    const plugin = await SnapshotBeforeTool(context);
    await plugin.event!(makeEvent("bash", "automod nif info mesh.nif"));
    // Should proceed (not filtered by tool name)
    const testCalls = calls.filter((c) => c.cmd.includes("test -d"));
    assert.ok(testCalls.length > 0, "Should check source directory");
  });

  it("handles commands with leading whitespace", async () => {
    const { context, calls } = createMockContext(projectDir);
    const plugin = await SnapshotBeforeTool(context);
    await plugin.event!(makeEvent("Bash", "  ls Data/"));
    const snapshotCalls = calls.filter((c) => c.cmd.includes("find"));
    assert.equal(snapshotCalls.length, 0, "Should skip info command with leading whitespace");
  });
});
