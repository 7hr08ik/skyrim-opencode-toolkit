# Changelog

## v3.2.1 — 2026-07-26

Hotfix release. `setup.sh` only — no tool or knowledgebase changes. If you installed v3.1 or v3.2,
re-run `bash setup.sh` against a fresh copy of `CLAUDE.md` (or fix the two Key Paths lines by hand);
the paths it wrote for you were wrong.

### Fixes
- **The Load Order path written into CLAUDE.md was corrupted on every Windows install.**
  `$LOCALAPPDATA` is backslash-delimited, and it was fed straight into `sed`'s replacement text,
  where GNU sed treats `\U`, `\a` etc. as escapes — `C:\Users\You\AppData\Local` came out as
  `C:SERSYOUAPPDATAocal`. Both `$LOCALAPPDATA` and the Documents path are now normalized to forward
  slashes before substitution. Affects v3.1 and v3.2. (Fix by @awesmdiver.)
- **SE installs with a redirected Documents folder were detected as VR.** `DOCUMENTS_DIR` was
  hardcoded to `C:/Users/<you>/Documents`, so a Documents folder moved by OneDrive "Back up your
  folders", a manual Properties → Location move, or a GPO redirect matched neither `My Games`
  probe and fell through to the `Skyrim VR` default. Now resolved via
  `[Environment]::GetFolderPath('MyDocuments')`, with the old hardcoded path as fallback.
  (Fix by @awesmdiver.)
- **The game root written into CLAUDE.md was an MSYS path, not a Windows path.** `pwd` under Git
  Bash returns `/c/Games/Skyrim` — a form Claude's file tools and PowerShell can't open. CLAUDE.md
  now gets the `C:/Games/Skyrim` form (`pwd -W`); the script's own filesystem work is unchanged.
- **SE/VR detection ignored the one unambiguous signal.** A fresh install that had never been
  launched has no `My Games/<variant>/` folder yet, so detection fell through to `Skyrim VR` even
  when only `SkyrimSE.exe` was present. The game folder's `.exe` is now the primary signal, with
  the config-folder probe as the tiebreaker.
- Removed a dead `{{USERNAME}}` substitution — no such placeholder exists in the CLAUDE.md template.

---

## v3.2 — 2026-07-09

### Fixes
- **xelib scripts couldn't find the wrapper on a fresh install.** `tools/xelib/loader_diag.js`,
  `tools/xelib/active-plugins.js`, and `tools/resaver-resolve-names.js` used `require('./xelib')`,
  which resolves to a local file that only exists in a dev layout — on a clean install they threw
  `MODULE_NOT_FOUND`. All now `require('xeditlib')` (the real package name). Install xeditlib **from
  the toolkit root** (`npm install github:WingedGuardian/xeditlib`) so Node's upward module lookup
  finds it from `tools/` and `examples/` alike; the bundled `XEditLib.dll` + `*.Hardcoded.dat` load
  relative to the package, so the scripts are cwd-independent. Docs/setup updated to say so.
  (Thanks to @awesmdiver for reporting the broken require paths.)

### New Capabilities
- **ReSaver CLI — changeform-level diagnostics.** New read ops `recon` (sync-aware parse-coverage
  scan of all changeform body types), `changeform` (parse one changeform body), `extradata-scan`,
  `changeform-diff`, `globaldata`/`globaldata-diff`, `freeze-report`; new verify-gated write ops
  `reset-havok`, `cleanse-formlists`, `remove-created`, plus a `verify-roundtrip` self-test. Every
  `--apply` is verify-gated (the output is re-read and compared to the written model; on any
  unintended divergence the file is deleted and the op fails). Read/diagnostic ops layer a small
  **analysis overlay** (modified ReSaver source, Apache-2.0 — see
  `tools/resaver-cli/analysis-overlay/NOTICE.md`) in front of your jar for extra parse coverage;
  write ops always run the STOCK jar; if the overlay can't compile against your ReSaver version the
  wrapper falls back to stock parsing automatically. JVM flags are now JDK-version-gated so the tool
  starts on JDK 17–22 (not just 23+).
- **cosave-info** (`tools/cosave-cli.sh` + `tools/cosave-info.py`) — read-only structural survey of
  an SKSE `.skse` co-save → JSON: which mods stashed co-save data (StorageUtil/PapyrusUtil/
  JContainers/per-mod blobs) and how much — the mod-state landscape the `.ess` itself never exposes.

---

## v3.1 — 2026-06-27

### New Capabilities
- **ReSaver CLI** (`tools/resaver-cli.sh`) — headless `.ess` save parsing, querying, cross-referencing,
  and cleaning, driving ReSaver's (FallrimTools) Java library. Ops: `info` / `dump` / `find` /
  `find-refs` / `worries` / `set-global` / `set-var` / `clean`. Writes are dry-run unless `--apply` and
  always go to a NEW file (never overwriting the input); FormID→EditorID resolution via
  `tools/resaver-resolve-names.js`. Supersedes raw binary byte-scanning for structured save work.

### Reliability Fixes
- **AutoMod** — `tools/automod-cli.sh` now invokes the **prebuilt `spookys-automod.dll`** instead of
  `dotnet run`, eliminating the per-call recompile / MSB1025 failures.
- **Spriggit** — `tools/spriggit-cli.sh` runs deep/nested output paths in a shallow workspace,
  fixing the `UnauthorizedAccessException` on deeply-nested paths (preserves the exact basename = ModKey).
- **xelib** — `tools/xelib/active-plugins.js` `loadActive()` handles the case where the SSE `plugins.txt`
  the GM_SSE loader expects is absent on a VR install (which otherwise fails silently).

### Setup Instructions Overhaul
- Every optional tool now has explicit acquisition/build instructions in CLAUDE.md, setup.sh,
  SETUP_PROMPT.txt, and README.md — including the AutoMod clone + Cli-project build (fixes Claude
  treating the AutoMod CLI as "fictional" when it wasn't already present).

---

## v3.0 — 2026-06-23

### New Capabilities
- **Author animated NIFs from scratch (PyNifly)** — self-spinning meshes (a `SpecialIdle`
  NiControllerSequence that auto-loops on a placed Activator with zero scripting), telescoping/
  extending geometry, and transform-keyframed effects. PyNifly writes the controller blocks correctly
  (hand-rolled PyFFI authoring CTDs the engine). It also reads/writes SSE **BSTriShape** meshes, which
  PyFFI cannot.
- **Headless render-verify loop** — `tools/blender-nif-validate.py` (independent PyNifly parse gate) +
  `tools/blender-nif-render.py` (render a NIF to PNG) confirm a mesh/VFX fix in chat before a game
  launch. NifSkope serves as the independent visual gate. "Author → validate → render-proof."
- **NIF geometry surgery** — `tools/pyffi-geometry-split.py` (split one shape into two for independent
  shaders / partial-mesh glow), plus the glow-map / mesh-split / stretch techniques documented in the
  knowledgebase.
- **AutoMod CLI** (`tools/automod-cli.sh`) — NIF / BSA / audio / MCM / ESP modules surfaced as a
  first-class tool.
- **ESP cross-reference integrity guard** — `tools/esp-verify-wrapper.sh` snapshots and diffs every
  record's cross-references (FormID + target master) to catch silent re-mastering / dropped-reference
  corruption from bulk remaps.
- **Snapshot-before-edit hook** — `.claude/hooks/snapshot-before-tool.sh` auto-snapshots active
  `.psc`/`.pex` files before every Bash command (external tools bypass the Edit/Write backup hook),
  with rate limiting and auto-pruning.

### Knowledgebase
- Grown and **fully scrubbed** to ~1,381 lines of generalizable, project-agnostic knowledge.
- New engine sections: Havok game units (≈70:1), the VR melee hit-detection stack + engine melee-range
  cap, spawned-actor Havok CTD (`Is3DLoaded()` guard), no-Papyrus-raycast limit, immobilizing the
  player/NPCs in VR (SetDontMove vs DisablePlayerControls vs EnableAI, with aggro/VRIK interactions),
  the NIF validation/render trichotomy, PyFFI limits & PyNifly authoring, the Music System (MUSC vs
  MUST, ducking-bypass, FNAM flags), SOUN-vs-SNDR wiring, the WAV→XWM pipeline, the Papyrus VM
  page-policy CTD on heavy modlists, and more.

### CLAUDE.md
- New principle sections: Vanilla Game as Frame of Reference, Native Engine Solutions First, Do Your
  Homework (due diligence), and Cognitive Co-Pilot (anticipate, don't just comply).
- New tool docs: PyFFI, PyNifly, AutoMod CLI, the NIF validation/render trichotomy, and the
  esp-verify integrity guard — all version-agnostic.

---

## v2.0

### New Capabilities
- **ESP editing via Spriggit** — Serialize any ESP to human-readable YAML, edit directly, deserialize back. Now the primary recommended workflow for record editing.
- **AutoMod CLI integration** — NIF mesh inspection and editing, BSA archive CRUD, audio file processing (FUZ/XWM/WAV), and MCM menu generation via SpookyPirate's AutoMod Toolkit.
- **Save file analysis** — New `scripts/read-save.py` + `skyrim-save` skill. Decompress .ess saves, extract the full plugin list, search for orphaned scripts, detect effect accumulation, check mod footprint, and monitor save bloat over time.
- **8 Claude Code skills** — Auto-loading slash commands: `/inspect-esp`, `/port-to-vr`, `/create-mod`. Auto-context for NIFs, BSAs, audio files, save files, and general Skyrim modding context.

### Changes
- Version-agnostic: fully supports SE, AE, VR, and LE. Not VR-exclusive despite VR origins.
- Framing updated to reflect actual strengths: power user tool for porting, debugging, and editing — complex mods from scratch require iteration.
- Setup prompt updated to include AutoMod CLI as an optional install.
- Knowledgebase expanded with save file format documentation.
- README reordered: porting and debugging examples now lead; new-mod-from-scratch examples follow with honest caveats.

---

## v1.4

- Added `scripts/read-save.py` (LZ4 decompression, plugin list parsing, binary search)
- Added `skyrim-save` skill
- Save File Analysis section added to knowledgebase

## v1.3

- SpookyPirate AutoMod CLI integrated (NIF, BSA, audio, MCM modules)
- AutoMod CLI safety hooks added to `protect-bash.sh`
- `automod-cli.sh` wrapper script added

## v1.2

- Spriggit added as primary ESP editing workflow
- `inspect-esp`, `port-to-vr`, `create-mod` skills added
- `skyrim-nif`, `skyrim-bsa`, `skyrim-audio`, `skyrim-mcm` skills added
- CLAUDE.md template generalized with `{{GAME_ROOT}}` / `{{USERNAME}}` placeholders

## v1.1

- Knowledgebase generalized from VR-specific to version-agnostic (SE/AE/VR/LE)
- VR-specific content moved to labeled subsections
- setup.sh detects both `Skyrim VR` and `Skyrim Special Edition` document paths

## v1.0

- Initial release
- xeditlib integration (Delphi FFI fixes open-sourced on GitHub)
- Safety hooks: command guard, file guard, auto-backup with audit log
- Confidence system and investigation-first workflow
- 600+ line Skyrim knowledgebase
- `skyrim-context` skill (auto-loads for .psc, .pex, Data/, .ini files)
