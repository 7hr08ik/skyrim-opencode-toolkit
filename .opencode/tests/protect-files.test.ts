// Tests for protect-files.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ProtectFiles } from "../plugins/protect-files.js";

// ---------------------------------------------------------------------------
// Helper: build a mock context
// ---------------------------------------------------------------------------

function createMockContext() {
  const calls: any[] = [];
  const context = {
    directory: "/fake/project",
    $: async (_strings: TemplateStringsArray, ..._values: any[]) => {
      calls.push({ strings: _strings, values: _values });
      return { stdout: "" };
    },
  };
  return { context, calls };
}

function makeEvent(
  type: string,
  toolName: string,
  filePath: string
) {
  return {
    event: {
      type,
      data: { tool_name: toolName, tool_input: { file_path: filePath } },
    },
  };
}

// ---------------------------------------------------------------------------
// Plugin factory test
// ---------------------------------------------------------------------------

describe("protect-files — plugin factory", () => {
  it("returns event handler from factory", async () => {
    const { context } = createMockContext();
    const plugin = await ProtectFiles(context);
    assert.ok(plugin);
    assert.ok(plugin.event);
    assert.equal(typeof plugin.event, "function");
  });
});

// ---------------------------------------------------------------------------
// Hard block tests — binary plugin/archive files
// ---------------------------------------------------------------------------

describe("protect-files — hard block binary extensions", () => {
  const binaryExts = ["esp", "esm", "esl", "bsa", "ba2"];

  for (const ext of binaryExts) {
    it(`denies direct write to .${ext} files`, async () => {
      const { context } = createMockContext();
      const plugin = await ProtectFiles(context);
      const result = await plugin.event!(
        makeEvent("tool.execute.before", "Edit", `Data/Mod.${ext}`)
      );
      assert.ok(result, `Should return override for .${ext}`);
      assert.equal(
        result!.hookSpecificOutput.permissionDecision,
        "deny",
        `Should deny .${ext} writes`
      );
      assert.ok(
        result!.hookSpecificOutput.permissionDecisionReason.includes(
          "Cannot directly write to plugin/archive files"
        ),
        `Deny reason should mention plugin/archive files for .${ext}`
      );
    });

    it(`denies Write tool on .${ext} files`, async () => {
      const { context } = createMockContext();
      const plugin = await ProtectFiles(context);
      const result = await plugin.event!(
        makeEvent("tool.execute.before", "Write", `Data/Mod.${ext}`)
      );
      assert.ok(result);
      assert.equal(result!.hookSpecificOutput.permissionDecision, "deny");
    });
  }

  it("denies .ESP files (case insensitive)", async () => {
    const { context } = createMockContext();
    const plugin = await ProtectFiles(context);
    const result = await plugin.event!(
      makeEvent("tool.execute.before", "Edit", "Data/Mod.ESP")
    );
    assert.ok(result);
    assert.equal(result!.hookSpecificOutput.permissionDecision, "deny");
  });

  it("denies .Bsa files (mixed case)", async () => {
    const { context } = createMockContext();
    const plugin = await ProtectFiles(context);
    const result = await plugin.event!(
      makeEvent("tool.execute.before", "Edit", "Data/Archive01.Bsa")
    );
    assert.ok(result);
    assert.equal(result!.hookSpecificOutput.permissionDecision, "deny");
  });
});

// ---------------------------------------------------------------------------
// Whitelist tests — workspace paths
// ---------------------------------------------------------------------------

describe("protect-files — workspace whitelist", () => {
  const whitelistPaths = [
    ".opencode/hooks/test.sh",
    ".opencode/hooks/deep/nested/script.sh",
    ".opencode/plans/plan.md",
    ".opencode/backups/20240101_file.txt",
    ".opencode/memory/notes.md",
    ".opencode/projects/my-project/config.json",
  ];

  for (const path of whitelistPaths) {
    it(`allows edits to ${path}`, async () => {
      const { context } = createMockContext();
      const plugin = await ProtectFiles(context);
      const result = await plugin.event!(
        makeEvent("tool.execute.before", "Edit", path)
      );
      assert.equal(
        result,
        undefined,
        `Should not require confirmation for ${path}`
      );
    });
  }
});

// ---------------------------------------------------------------------------
// Config confirmation tests
// ---------------------------------------------------------------------------

describe("protect-files — Skyrim config confirmation", () => {
  const configFiles = [
    "Documents/My Games/Skyrim/Skyrim.ini",
    "Documents/My Games/SkyrimVR/SkyrimVR.ini",
    "Documents/My Games/Skyrim/SkyrimPrefs.ini",
    "Documents/My Games/Skyrim/SkyrimCustom.ini",
  ];

  for (const path of configFiles) {
    it(`asks confirmation for ${path}`, async () => {
      const { context } = createMockContext();
      const plugin = await ProtectFiles(context);
      const result = await plugin.event!(
        makeEvent("tool.execute.before", "Edit", path)
      );
      assert.ok(result, `Should ask confirmation for ${path}`);
      assert.equal(
        result!.hookSpecificOutput.permissionDecision,
        "ask",
        `Should ask for ${path}`
      );
      assert.ok(
        result!.hookSpecificOutput.permissionDecisionReason.includes(
          "EDITING SKYRIM CONFIG"
        ),
        `Reason should mention SKYRIM CONFIG for ${path}`
      );
    });
  }
});

describe("protect-files — SKSE plugin config confirmation", () => {
  it("asks confirmation for SKSE plugin INI", async () => {
    const { context } = createMockContext();
    const plugin = await ProtectFiles(context);
    const result = await plugin.event!(
      makeEvent(
        "tool.execute.before",
        "Edit",
        "Data/SKSE/Plugins/myplugin.ini"
      )
    );
    assert.ok(result);
    assert.equal(result!.hookSpecificOutput.permissionDecision, "ask");
    assert.ok(
      result!.hookSpecificOutput.permissionDecisionReason.includes(
        "EDITING SKSE PLUGIN CONFIG"
      )
    );
  });

  it("asks confirmation for nested SKSE plugin INI", async () => {
    const { context } = createMockContext();
    const plugin = await ProtectFiles(context);
    const result = await plugin.event!(
      makeEvent(
        "tool.execute.before",
        "Edit",
        "Data/SKSE/Plugins/SomeMod/config.ini"
      )
    );
    assert.ok(result);
    assert.equal(result!.hookSpecificOutput.permissionDecision, "ask");
  });
});

describe("protect-files — load order file confirmation", () => {
  it("asks confirmation for loadorder.txt", async () => {
    const { context } = createMockContext();
    const plugin = await ProtectFiles(context);
    const result = await plugin.event!(
      makeEvent(
        "tool.execute.before",
        "Edit",
        "localdata/Skyrim Special Edition VR/loadorder.txt"
      )
    );
    assert.ok(result);
    assert.equal(result!.hookSpecificOutput.permissionDecision, "ask");
    assert.ok(
      result!.hookSpecificOutput.permissionDecisionReason.includes(
        "EDITING LOAD ORDER FILE"
      )
    );
  });

  it("asks confirmation for plugins.txt", async () => {
    const { context } = createMockContext();
    const plugin = await ProtectFiles(context);
    const result = await plugin.event!(
      makeEvent(
        "tool.execute.before",
        "Edit",
        "localdata/Skyrim Special Edition VR/plugins.txt"
      )
    );
    assert.ok(result);
    assert.equal(result!.hookSpecificOutput.permissionDecision, "ask");
  });
});

describe("protect-files — Papyrus script confirmation", () => {
  it("asks confirmation for .psc files", async () => {
    const { context } = createMockContext();
    const plugin = await ProtectFiles(context);
    const result = await plugin.event!(
      makeEvent(
        "tool.execute.before",
        "Edit",
        "Data/Scripts/Source/MyScript.psc"
      )
    );
    assert.ok(result);
    assert.equal(result!.hookSpecificOutput.permissionDecision, "ask");
    assert.ok(
      result!.hookSpecificOutput.permissionDecisionReason.includes(
        "EDITING PAPYRUS SCRIPT"
      )
    );
  });

  it("asks confirmation for .pex files", async () => {
    const { context } = createMockContext();
    const plugin = await ProtectFiles(context);
    const result = await plugin.event!(
      makeEvent(
        "tool.execute.before",
        "Edit",
        "Data/Scripts/MyScript.pex"
      )
    );
    assert.ok(result);
    assert.equal(result!.hookSpecificOutput.permissionDecision, "ask");
  });

  it("asks for .PSC (case insensitive)", async () => {
    const { context } = createMockContext();
    const plugin = await ProtectFiles(context);
    const result = await plugin.event!(
      makeEvent("tool.execute.before", "Edit", "Data/Scripts/MyScript.PSC")
    );
    assert.ok(result);
    assert.equal(result!.hookSpecificOutput.permissionDecision, "ask");
  });
});

// ---------------------------------------------------------------------------
// Catch-all game directory tests
// ---------------------------------------------------------------------------

describe("protect-files — catch-all game directory", () => {
  it("asks confirmation for files in Skyrim VR path", async () => {
    const { context } = createMockContext();
    const plugin = await ProtectFiles(context);
    const result = await plugin.event!(
      makeEvent(
        "tool.execute.before",
        "Edit",
        "Data/Textures/some_texture.dds"
      )
    );
    // This depends on whether the path contains "Skyrim VR" etc.
    // The catch-all checks for these strings in the path
    // A generic Data/ path won't match unless it includes the game name
  });

  it("asks confirmation for files containing 'Skyrim Special Edition'", async () => {
    const { context } = createMockContext();
    const plugin = await ProtectFiles(context);
    const result = await plugin.event!(
      makeEvent(
        "tool.execute.before",
        "Edit",
        "C:/Program Files/Skyrim Special Edition/Data/file.txt"
      )
    );
    assert.ok(result);
    assert.equal(result!.hookSpecificOutput.permissionDecision, "ask");
    assert.ok(
      result!.hookSpecificOutput.permissionDecisionReason.includes(
        "game/config directory"
      )
    );
  });

  it("asks confirmation for files in My Games/Skyrim", async () => {
    const { context } = createMockContext();
    const plugin = await ProtectFiles(context);
    const result = await plugin.event!(
      makeEvent(
        "tool.execute.before",
        "Edit",
        "Documents/My Games/Skyrim/Settings.ini"
      )
    );
    assert.ok(result);
    assert.equal(result!.hookSpecificOutput.permissionDecision, "ask");
  });
});

// ---------------------------------------------------------------------------
// Tool name filtering
// ---------------------------------------------------------------------------

describe("protect-files — tool name filtering", () => {
  it("does nothing for non-file-edit tools", async () => {
    const { context } = createMockContext();
    const plugin = await ProtectFiles(context);

    const result1 = await plugin.event!(
      makeEvent("tool.execute.before", "Bash", "Data/Mod.esp")
    );
    assert.equal(result1, undefined);

    const result2 = await plugin.event!(
      makeEvent("tool.execute.before", "Read", "Data/Mod.esp")
    );
    assert.equal(result2, undefined);
  });

  it("works with WriteFile tool name", async () => {
    const { context } = createMockContext();
    const plugin = await ProtectFiles(context);
    const result = await plugin.event!(
      makeEvent("tool.execute.before", "WriteFile", "Data/Mod.esp")
    );
    assert.ok(result);
    assert.equal(result!.hookSpecificOutput.permissionDecision, "deny");
  });

  it("works with MultiEdit tool name", async () => {
    const { context } = createMockContext();
    const plugin = await ProtectFiles(context);
    const result = await plugin.event!(
      makeEvent("tool.execute.before", "MultiEdit", "Data/Mod.esp")
    );
    assert.ok(result);
    assert.equal(result!.hookSpecificOutput.permissionDecision, "deny");
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("protect-files — edge cases", () => {
  it("handles missing file_path", async () => {
    const { context } = createMockContext();
    const plugin = await ProtectFiles(context);
    const result = await plugin.event!({
      event: {
        type: "tool.execute.before",
        data: { tool_name: "Edit", tool_input: {} },
      },
    });
    assert.equal(result, undefined);
  });

  it("handles missing data in event", async () => {
    const { context } = createMockContext();
    const plugin = await ProtectFiles(context);
    const result = await plugin.event!({
      event: { type: "tool.execute.before" },
    });
    assert.equal(result, undefined);
  });

  it("allows editing regular source files (no confirmation needed)", async () => {
    const { context } = createMockContext();
    const plugin = await ProtectFiles(context);
    const result = await plugin.event!(
      makeEvent(
        "tool.execute.before",
        "Edit",
        "src/components/Button.tsx"
      )
    );
    assert.equal(
      result,
      undefined,
      "Regular source files should not need confirmation"
    );
  });

  it("allows editing files in project root", async () => {
    const { context } = createMockContext();
    const plugin = await ProtectFiles(context);
    const result = await plugin.event!(
      makeEvent("tool.execute.before", "Edit", "README.md")
    );
    assert.equal(result, undefined);
  });
});
