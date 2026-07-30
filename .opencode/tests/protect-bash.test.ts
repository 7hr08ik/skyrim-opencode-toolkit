// Tests for protect-bash.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ProtectBash } from "../plugins/protect-bash.js";

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

function makeEvent(type: string, toolName: string, command: string) {
  return {
    event: {
      type,
      data: { tool_name: toolName, tool_input: { command } },
    },
  };
}

// ---------------------------------------------------------------------------
// Plugin factory test
// ---------------------------------------------------------------------------

describe("protect-bash — plugin factory", () => {
  it("returns event handler from factory", async () => {
    const { context } = createMockContext();
    const plugin = await ProtectBash(context);
    assert.ok(plugin);
    assert.ok(plugin.event);
    assert.equal(typeof plugin.event, "function");
  });
});

// ---------------------------------------------------------------------------
// Hard deny tests
// ---------------------------------------------------------------------------

describe("protect-bash — hard deny patterns", () => {
  it("denies rm of game installation directory (C:/ path)", async () => {
    const { context } = createMockContext();
    const plugin = await ProtectBash(context);
    const result = await plugin.event!(
      makeEvent("tool.execute.before", "Bash", 'rm -rf "C:/Skyrim Special Edition"')
    );
    assert.ok(result);
    assert.equal(
      result!.hookSpecificOutput.permissionDecision,
      "deny",
      "Should deny deletion of game directory"
    );
    assert.ok(
      result!.hookSpecificOutput.permissionDecisionReason.includes(
        "Cannot delete the game installation directory"
      )
    );
  });

  it("denies rm of game installation directory (/c/ path)", async () => {
    const { context } = createMockContext();
    const plugin = await ProtectBash(context);
    const result = await plugin.event!(
      makeEvent("tool.execute.before", "Bash", "rm -rf /c/Skyrim")
    );
    assert.ok(result);
    assert.equal(result!.hookSpecificOutput.permissionDecision, "deny");
  });

  it("denies rm with -f flag of game directory", async () => {
    const { context } = createMockContext();
    const plugin = await ProtectBash(context);
    const result = await plugin.event!(
      makeEvent("tool.execute.before", "Bash", "rm -f \"C:/Games/Skyrim\"")
    );
    assert.ok(result);
    assert.equal(result!.hookSpecificOutput.permissionDecision, "deny");
  });

  it("denies rm of Skyrim config directory", async () => {
    const { context } = createMockContext();
    const plugin = await ProtectBash(context);
    const result = await plugin.event!(
      makeEvent(
        "tool.execute.before",
        "Bash",
        'rm -rf "C:/Users/me/Documents/My Games/Skyrim Special Edition"'
      )
    );
    assert.ok(result);
    assert.equal(result!.hookSpecificOutput.permissionDecision, "deny");
    assert.ok(
      result!.hookSpecificOutput.permissionDecisionReason.includes(
        "Cannot delete the Skyrim config directory"
      )
    );
  });

  it("denies reg delete of Bethesda keys", async () => {
    const { context } = createMockContext();
    const plugin = await ProtectBash(context);
    const result = await plugin.event!(
      makeEvent("tool.execute.before", "Bash", "reg delete Bethesda")
    );
    assert.ok(result);
    assert.equal(result!.hookSpecificOutput.permissionDecision, "deny");
    assert.ok(
      result!.hookSpecificOutput.permissionDecisionReason.includes(
        "Cannot delete Bethesda registry keys"
      )
    );
  });

  it("denies Remove-ItemProperty for Bethesda", async () => {
    const { context } = createMockContext();
    const plugin = await ProtectBash(context);
    const result = await plugin.event!(
      makeEvent(
        "tool.execute.before",
        "Bash",
        "Remove-ItemProperty -Path HKLM:\\Bethesda"
      )
    );
    assert.ok(result);
    assert.equal(result!.hookSpecificOutput.permissionDecision, "deny");
  });

  it("does not deny safe commands", async () => {
    const { context } = createMockContext();
    const plugin = await ProtectBash(context);
    const result = await plugin.event!(
      makeEvent("tool.execute.before", "Bash", "echo hello world")
    );
    assert.equal(result, undefined, "Should not return override for safe commands");
  });
});

// ---------------------------------------------------------------------------
// Confirm pattern tests
// ---------------------------------------------------------------------------

describe("protect-bash — confirm patterns", () => {
  it("asks confirmation for rm in game directory", async () => {
    const { context } = createMockContext();
    const plugin = await ProtectBash(context);
    const result = await plugin.event!(
      makeEvent("tool.execute.before", "Bash", "rm Data/ meshes/new.nif")
    );
    assert.ok(result);
    assert.equal(
      result!.hookSpecificOutput.permissionDecision,
      "ask",
      "Should ask for confirmation"
    );
    assert.ok(
      result!.hookSpecificOutput.permissionDecisionReason.includes(
        "Deleting files in game directory"
      )
    );
  });

  it("asks confirmation for rm with Skyrim in path", async () => {
    const { context } = createMockContext();
    const plugin = await ProtectBash(context);
    const result = await plugin.event!(
      makeEvent("tool.execute.before", "Bash", "rm Skyrim/old_file.txt")
    );
    assert.ok(result);
    assert.equal(result!.hookSpecificOutput.permissionDecision, "ask");
  });

  it("asks confirmation for cp to game directory", async () => {
    const { context } = createMockContext();
    const plugin = await ProtectBash(context);
    const result = await plugin.event!(
      makeEvent("tool.execute.before", "Bash", "cp new_file.txt Data/")
    );
    assert.ok(result);
    assert.equal(result!.hookSpecificOutput.permissionDecision, "ask");
    assert.ok(
      result!.hookSpecificOutput.permissionDecisionReason.includes(
        "Moving/copying files in game directory"
      )
    );
  });

  it("asks confirmation for mv to My Games/Skyrim", async () => {
    const { context } = createMockContext();
    const plugin = await ProtectBash(context);
    const result = await plugin.event!(
      makeEvent(
        "tool.execute.before",
        "Bash",
        "mv config.ini 'My Games/Skyrim/'"
      )
    );
    assert.ok(result);
    assert.equal(result!.hookSpecificOutput.permissionDecision, "ask");
  });

  it("asks confirmation for output redirect to Skyrim path", async () => {
    const { context } = createMockContext();
    const plugin = await ProtectBash(context);
    const result = await plugin.event!(
      makeEvent("tool.execute.before", "Bash", "echo hello > C:/Skyrim/output.txt")
    );
    assert.ok(result);
    assert.equal(result!.hookSpecificOutput.permissionDecision, "ask");
    assert.ok(
      result!.hookSpecificOutput.permissionDecisionReason.includes(
        "Redirecting output"
      )
    );
  });

  it("asks confirmation for sed -i in Data/", async () => {
    const { context } = createMockContext();
    const plugin = await ProtectBash(context);
    const result = await plugin.event!(
      makeEvent("tool.execute.before", "Bash", "sed -i 's/old/new/' Data/script.psc")
    );
    assert.ok(result);
    assert.equal(result!.hookSpecificOutput.permissionDecision, "ask");
    assert.ok(
      result!.hookSpecificOutput.permissionDecisionReason.includes(
        "In-place edit"
      )
    );
  });

  it("asks confirmation for .esp file reference", async () => {
    const { context } = createMockContext();
    const plugin = await ProtectBash(context);
    const result = await plugin.event!(
      makeEvent("tool.execute.before", "Bash", "ls Data/Followers.esp")
    );
    assert.ok(result);
    assert.equal(result!.hookSpecificOutput.permissionDecision, "ask");
    assert.ok(
      result!.hookSpecificOutput.permissionDecisionReason.includes(
        "plugin/archive files"
      )
    );
  });

  it("asks confirmation for .bsa file reference", async () => {
    const { context } = createMockContext();
    const plugin = await ProtectBash(context);
    const result = await plugin.event!(
      makeEvent("tool.execute.before", "Bash", "bsa info Archive01.bsa")
    );
    assert.ok(result);
    assert.equal(result!.hookSpecificOutput.permissionDecision, "ask");
  });

  it("asks confirmation for loadorder.txt reference", async () => {
    const { context } = createMockContext();
    const plugin = await ProtectBash(context);
    const result = await plugin.event!(
      makeEvent("tool.execute.before", "Bash", "cat loadorder.txt")
    );
    assert.ok(result);
    assert.equal(result!.hookSpecificOutput.permissionDecision, "ask");
    assert.ok(
      result!.hookSpecificOutput.permissionDecisionReason.includes(
        "load order"
      )
    );
  });

  it("asks confirmation for plugins.txt reference", async () => {
    const { context } = createMockContext();
    const plugin = await ProtectBash(context);
    const result = await plugin.event!(
      makeEvent("tool.execute.before", "Bash", "cat plugins.txt")
    );
    assert.ok(result);
    assert.equal(result!.hookSpecificOutput.permissionDecision, "ask");
  });

  it("does not confirm for commands without game references", async () => {
    const { context } = createMockContext();
    const plugin = await ProtectBash(context);
    const result = await plugin.event!(
      makeEvent("tool.execute.before", "Bash", "echo hello world")
    );
    assert.equal(result, undefined);
  });
});

// ---------------------------------------------------------------------------
// AutoMod ESP tests
// ---------------------------------------------------------------------------

describe("protect-bash — AutoMod ESP patterns", () => {
  it("asks confirmation for AutoMod add-weapon without --dry-run", async () => {
    const { context } = createMockContext();
    const plugin = await ProtectBash(context);
    const result = await plugin.event!(
      makeEvent(
        "tool.execute.before",
        "Bash",
        "bash tools/automod-cli.sh esp add-weapon --name TestWeapon"
      )
    );
    assert.ok(result);
    assert.equal(result!.hookSpecificOutput.permissionDecision, "ask");
    assert.ok(
      result!.hookSpecificOutput.permissionDecisionReason.includes(
        "AutoMod ESP write"
      )
    );
  });

  it("asks confirmation for SpookysAutomod add-spell without --dry-run", async () => {
    const { context } = createMockContext();
    const plugin = await ProtectBash(context);
    const result = await plugin.event!(
      makeEvent(
        "tool.execute.before",
        "Bash",
        "SpookysAutomod add-spell --name Fireball"
      )
    );
    assert.ok(result);
    assert.equal(result!.hookSpecificOutput.permissionDecision, "ask");
  });

  it("does NOT ask for AutoMod add-weapon WITH --dry-run", async () => {
    const { context } = createMockContext();
    const plugin = await ProtectBash(context);
    const result = await plugin.event!(
      makeEvent(
        "tool.execute.before",
        "Bash",
        "bash tools/automod-cli.sh esp add-weapon --dry-run --name TestWeapon"
      )
    );
    assert.equal(
      result,
      undefined,
      "Should not ask when --dry-run is present"
    );
  });

  it("asks for AutoMod merge without --dry-run", async () => {
    const { context } = createMockContext();
    const plugin = await ProtectBash(context);
    const result = await plugin.event!(
      makeEvent(
        "tool.execute.before",
        "Bash",
        "bash tools/automod-cli.sh esp merge mod1.esp mod2.esp"
      )
    );
    assert.ok(result);
    assert.equal(result!.hookSpecificOutput.permissionDecision, "ask");
  });

  it("does NOT ask for AutoMod merge WITH --dry-run", async () => {
    const { context } = createMockContext();
    const plugin = await ProtectBash(context);
    const result = await plugin.event!(
      makeEvent(
        "tool.execute.before",
        "Bash",
        "bash tools/automod-cli.sh esp merge --dry-run mod1.esp mod2.esp"
      )
    );
    assert.equal(result, undefined);
  });

  it("asks for all ESP write subcommands", async () => {
    const espCommands = [
      "add-weapon",
      "add-spell",
      "add-armor",
      "add-npc",
      "add-quest",
      "add-perk",
      "add-book",
      "add-global",
      "add-faction",
      "add-leveled-item",
      "add-form-list",
      "add-encounter-zone",
      "add-location",
      "add-outfit",
      "attach-script",
      "set-property",
      "auto-fill",
      "merge",
      "generate-seq",
    ];

    for (const cmd of espCommands) {
      const { context } = createMockContext();
      const plugin = await ProtectBash(context);
      const result = await plugin.event!(
        makeEvent(
          "tool.execute.before",
          "Bash",
          `automod esp ${cmd} --fake-arg`
        )
      );
      assert.ok(
        result,
        `Should ask confirmation for AutoMod ESP ${cmd}`
      );
      assert.equal(
        result!.hookSpecificOutput.permissionDecision,
        "ask",
        `Should ask for ${cmd}`
      );
    }
  });
});

// ---------------------------------------------------------------------------
// AutoMod NIF tests
// ---------------------------------------------------------------------------

describe("protect-bash — AutoMod NIF patterns", () => {
  it("asks confirmation for replace-textures", async () => {
    const { context } = createMockContext();
    const plugin = await ProtectBash(context);
    const result = await plugin.event!(
      makeEvent(
        "tool.execute.before",
        "Bash",
        "automod nif replace-textures mesh.nif new_tex.dds"
      )
    );
    assert.ok(result);
    assert.equal(result!.hookSpecificOutput.permissionDecision, "ask");
    assert.ok(
      result!.hookSpecificOutput.permissionDecisionReason.includes(
        "AutoMod NIF"
      )
    );
  });

  it("asks confirmation for fix-eyes", async () => {
    const { context } = createMockContext();
    const plugin = await ProtectBash(context);
    const result = await plugin.event!(
      makeEvent("tool.execute.before", "Bash", "automod nif fix-eyes face.nif")
    );
    assert.ok(result);
    assert.equal(result!.hookSpecificOutput.permissionDecision, "ask");
  });

  it("asks confirmation for scale", async () => {
    const { context } = createMockContext();
    const plugin = await ProtectBash(context);
    const result = await plugin.event!(
      makeEvent("tool.execute.before", "Bash", "automod nif scale mesh.nif 2.0")
    );
    assert.ok(result);
    assert.equal(result!.hookSpecificOutput.permissionDecision, "ask");
  });

  it("asks confirmation for rename-strings", async () => {
    const { context } = createMockContext();
    const plugin = await ProtectBash(context);
    const result = await plugin.event!(
      makeEvent(
        "tool.execute.before",
        "Bash",
        "automod nif rename-strings mesh.nif old new"
      )
    );
    assert.ok(result);
    assert.equal(result!.hookSpecificOutput.permissionDecision, "ask");
  });
});

// ---------------------------------------------------------------------------
// AutoMod Archive tests
// ---------------------------------------------------------------------------

describe("protect-bash — AutoMod archive patterns", () => {
  it("asks confirmation for archive create", async () => {
    const { context } = createMockContext();
    const plugin = await ProtectBash(context);
    const result = await plugin.event!(
      makeEvent(
        "tool.execute.before",
        "Bash",
        "automod archive create output.bsa input/"
      )
    );
    assert.ok(result);
    assert.equal(result!.hookSpecificOutput.permissionDecision, "ask");
    assert.ok(
      result!.hookSpecificOutput.permissionDecisionReason.includes(
        "AutoMod archive"
      )
    );
  });

  it("asks confirmation for archive add-files", async () => {
    const { context } = createMockContext();
    const plugin = await ProtectBash(context);
    const result = await plugin.event!(
      makeEvent(
        "tool.execute.before",
        "Bash",
        "automod archive add-files mod.bsa file.txt"
      )
    );
    assert.ok(result);
    assert.equal(result!.hookSpecificOutput.permissionDecision, "ask");
  });

  it("asks confirmation for archive merge", async () => {
    const { context } = createMockContext();
    const plugin = await ProtectBash(context);
    const result = await plugin.event!(
      makeEvent(
        "tool.execute.before",
        "Bash",
        "automod archive merge out.bsa a.bsa b.bsa"
      )
    );
    assert.ok(result);
    assert.equal(result!.hookSpecificOutput.permissionDecision, "ask");
  });

  it("asks confirmation for archive optimize", async () => {
    const { context } = createMockContext();
    const plugin = await ProtectBash(context);
    const result = await plugin.event!(
      makeEvent(
        "tool.execute.before",
        "Bash",
        "automod archive optimize mod.bsa"
      )
    );
    assert.ok(result);
    assert.equal(result!.hookSpecificOutput.permissionDecision, "ask");
  });
});

// ---------------------------------------------------------------------------
// Tool name filtering
// ---------------------------------------------------------------------------

describe("protect-bash — tool name filtering", () => {
  it("does nothing for non-Bash tools", async () => {
    const { context } = createMockContext();
    const plugin = await ProtectBash(context);

    const dangerousCmd = 'rm -rf "C:/Skyrim"';

    const result1 = await plugin.event!(
      makeEvent("tool.execute.before", "Edit", dangerousCmd)
    );
    assert.equal(result1, undefined);

    const result2 = await plugin.event!(
      makeEvent("tool.execute.before", "Read", dangerousCmd)
    );
    assert.equal(result2, undefined);
  });

  it("handles case-insensitive 'bash' tool name", async () => {
    const { context } = createMockContext();
    const plugin = await ProtectBash(context);

    const result = await plugin.event!(
      makeEvent("tool.execute.before", "bash", "rm Data/test.esp")
    );
    assert.ok(result);
    assert.equal(result!.hookSpecificOutput.permissionDecision, "ask");
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("protect-bash — edge cases", () => {
  it("handles empty command", async () => {
    const { context } = createMockContext();
    const plugin = await ProtectBash(context);
    const result = await plugin.event!(
      makeEvent("tool.execute.before", "Bash", "")
    );
    assert.equal(result, undefined);
  });

  it("handles missing command in tool_input", async () => {
    const { context } = createMockContext();
    const plugin = await ProtectBash(context);
    const result = await plugin.event!({
      event: {
        type: "tool.execute.before",
        data: { tool_name: "Bash", tool_input: {} },
      },
    });
    assert.equal(result, undefined);
  });

  it("handles missing data in event", async () => {
    const { context } = createMockContext();
    const plugin = await ProtectBash(context);
    const result = await plugin.event!({
      event: { type: "tool.execute.before" },
    });
    assert.equal(result, undefined);
  });

  it("does not interfere with safe rm of non-game files", async () => {
    const { context } = createMockContext();
    const plugin = await ProtectBash(context);
    const result = await plugin.event!(
      makeEvent("tool.execute.before", "Bash", "rm /tmp/somefile.txt")
    );
    assert.equal(result, undefined);
  });
});
