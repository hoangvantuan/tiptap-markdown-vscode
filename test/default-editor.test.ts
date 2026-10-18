import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  computeUpdatedAssociations,
  getCurrentWorkspaceMode,
  buildQuickPickOptions,
  useAsDefaultEditor,
} from "../src/host/defaultEditor";
import {
  setWorkspaceRoot,
  resetStub,
  window,
} from "./vscode-stub";

/** The eight keys #169 makes this command write: four schemes x two extensions. */
const SCHEME_KEYS = [
  "file:/**/*.md",
  "vscode-remote:/**/*.md",
  "vscode-vfs:/**/*.md",
  "untitled:/**/*.md",
  "file:/**/*.markdown",
  "vscode-remote:/**/*.markdown",
  "vscode-vfs:/**/*.markdown",
  "untitled:/**/*.markdown",
];

describe("default-editor", () => {
  let tmpDir: string;

  beforeEach(() => {
    resetStub();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tuimd-editor-assoc-test-"));
    setWorkspaceRoot(tmpDir);
  });

  afterEach(() => {
    resetStub();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  describe("computeUpdatedAssociations", () => {
    it("sets Tiptap Markdown editor on the four selected schemes for wysiwyg mode", () => {
      const updated = computeUpdatedAssociations({}, "wysiwyg");
      assert.deepEqual(updated, {
        "file:/**/*.md": "tuiMarkdown.editor",
        "vscode-remote:/**/*.md": "tuiMarkdown.editor",
        "vscode-vfs:/**/*.md": "tuiMarkdown.editor",
        "untitled:/**/*.md": "tuiMarkdown.editor",
        "file:/**/*.markdown": "tuiMarkdown.editor",
        "vscode-remote:/**/*.markdown": "tuiMarkdown.editor",
        "vscode-vfs:/**/*.markdown": "tuiMarkdown.editor",
        "untitled:/**/*.markdown": "tuiMarkdown.editor",
      });
    });

    it("sets default text editor on the four selected schemes for text mode", () => {
      const updated = computeUpdatedAssociations({}, "text");
      assert.deepEqual(
        updated,
        Object.fromEntries(SCHEME_KEYS.map((k) => [k, "default"])),
      );
    });

    it("never writes a bare `*.md`, which VS Code matches on every scheme", () => {
      for (const mode of ["wysiwyg", "text"] as const) {
        const keys = Object.keys(computeUpdatedAssociations({}, mode) ?? {});
        assert.equal(keys.includes("*.md"), false, `${mode} must not write *.md`);
        assert.equal(keys.includes("*.markdown"), false, `${mode} must not write *.markdown`);
        assert.deepEqual(keys.sort(), [...SCHEME_KEYS].sort());
      }
    });

    it("replaces this command's own pre-#169 bare keys, in both spellings", () => {
      const updated = computeUpdatedAssociations(
        {
          "*.md": "tuiMarkdown.editor",
          "*.markdown": "default",
          "file:/**/*.md": "default",
        },
        "wysiwyg",
      );
      assert.equal(updated?.["*.md"], undefined);
      assert.equal(updated?.["*.markdown"], undefined);
      // the old scheme-qualified key is ours too, and takes the new value
      assert.equal(updated?.["file:/**/*.md"], "tuiMarkdown.editor");
      assert.equal(updated?.["untitled:/**/*.md"], "tuiMarkdown.editor");
    });

    it("leaves a bare `*.md` alone when its value is not one this command writes", () => {
      const updated = computeUpdatedAssociations({ "*.md": "someOther.editor" }, "wysiwyg");
      assert.equal(updated?.["*.md"], "someOther.editor");
      assert.equal(updated?.["file:/**/*.md"], "tuiMarkdown.editor");
    });

    it("removes markdown associations on reset while preserving other associations", () => {
      const current = {
        "*.md": "tuiMarkdown.editor",
        "*.markdown": "tuiMarkdown.editor",
        "file:/**/*.md": "tuiMarkdown.editor",
        "*.png": "imagePreview",
        "{git,gitlens}:/**/*.md": "default",
      };
      const updated = computeUpdatedAssociations(current, "reset");
      assert.deepEqual(updated, {
        "*.png": "imagePreview",
        "{git,gitlens}:/**/*.md": "default",
      });
    });

    it("reset does not delete a key whose value is not ours", () => {
      const current = {
        "*.md": "someOther.editor",
        "file:/**/*.markdown": "someOther.editor",
      };
      assert.deepEqual(computeUpdatedAssociations(current, "reset"), current);
    });

    it("returns undefined on reset when no other associations remain", () => {
      const current = {
        "*.md": "tuiMarkdown.editor",
        "*.markdown": "tuiMarkdown.editor",
      };
      const updated = computeUpdatedAssociations(current, "reset");
      assert.equal(updated, undefined);
    });
  });

  describe("getCurrentWorkspaceMode", () => {
    it("identifies wysiwyg, text, and default modes", () => {
      assert.equal(getCurrentWorkspaceMode({ "*.md": "tuiMarkdown.editor" }), "wysiwyg");
      assert.equal(getCurrentWorkspaceMode({ "*.md": "default" }), "text");
      assert.equal(getCurrentWorkspaceMode({}), "default");
      assert.equal(getCurrentWorkspaceMode(undefined), "default");
    });

    it("reads the scheme-qualified spelling", () => {
      assert.equal(
        getCurrentWorkspaceMode({ "file:/**/*.md": "tuiMarkdown.editor" }),
        "wysiwyg",
      );
      assert.equal(getCurrentWorkspaceMode({ "untitled:/**/*.markdown": "default" }), "text");
    });

    it("reads the pre-#169 bare spelling too, so an old workspace is still recognised", () => {
      assert.equal(
        getCurrentWorkspaceMode({ "*.markdown": "tuiMarkdown.editor" }),
        "wysiwyg",
      );
    });

    it("does not claim a bare key whose value belongs to somebody else", () => {
      assert.equal(getCurrentWorkspaceMode({ "*.md": "someOther.editor" }), "default");
    });
  });

  describe("buildQuickPickOptions", () => {
    it("marks current mode with (current) description", () => {
      const options = buildQuickPickOptions("text");
      const textOpt = options.find((o) => o.mode === "text");
      const wysiwygOpt = options.find((o) => o.mode === "wysiwyg");
      const resetOpt = options.find((o) => o.mode === "reset");

      assert.equal(textOpt?.description, "(current)");
      assert.equal(wysiwygOpt?.description, undefined);
      assert.equal(resetOpt?.description, undefined);
    });

    it("scopes the reset entry to what this extension wrote", () => {
      const resetOpt = buildQuickPickOptions("default").find((o) => o.mode === "reset");
      assert.match(resetOpt!.detail, /this extension wrote/);
    });
  });

  describe("useAsDefaultEditor (disk verification)", () => {
    const pick = async (mode: string) => {
      const origShowQuickPick = window.showQuickPick;
      window.showQuickPick = (async (items: any[]) =>
        items.find((item) => item.mode === mode)) as any;
      try {
        return await useAsDefaultEditor();
      } finally {
        window.showQuickPick = origShowQuickPick;
      }
    };

    const seedSettings = (assoc: Record<string, string>) => {
      const vscodeDir = path.join(tmpDir, ".vscode");
      fs.mkdirSync(vscodeDir, { recursive: true });
      fs.writeFileSync(
        path.join(vscodeDir, "settings.json"),
        JSON.stringify({ "workbench.editorAssociations": assoc }),
        "utf8",
      );
    };

    const readAssoc = (): unknown => {
      const settingsPath = path.join(tmpDir, ".vscode", "settings.json");
      return JSON.parse(fs.readFileSync(settingsPath, "utf8"))["workbench.editorAssociations"];
    };

    it("writes default text editor associations to .vscode/settings.json on disk", async () => {
      const mode = await pick("text");
      assert.equal(mode, "text");

      const settingsPath = path.join(tmpDir, ".vscode", "settings.json");
      assert.equal(fs.existsSync(settingsPath), true, "settings.json must exist on disk");
      assert.deepEqual(readAssoc(), Object.fromEntries(SCHEME_KEYS.map((k) => [k, "default"])));
    });

    it("writes Tiptap Markdown editor associations to .vscode/settings.json on disk", async () => {
      const mode = await pick("wysiwyg");
      assert.equal(mode, "wysiwyg");
      assert.deepEqual(
        readAssoc(),
        Object.fromEntries(SCHEME_KEYS.map((k) => [k, "tuiMarkdown.editor"])),
      );
    });

    it("cleans up a bare `*.md` this command wrote before, on disk", async () => {
      seedSettings({
        "*.md": "tuiMarkdown.editor",
        "*.markdown": "tuiMarkdown.editor",
        "*.png": "imagePreview",
      });
      const mode = await pick("wysiwyg");
      assert.equal(mode, "wysiwyg");
      assert.deepEqual(readAssoc(), {
        "*.png": "imagePreview",
        ...Object.fromEntries(SCHEME_KEYS.map((k) => [k, "tuiMarkdown.editor"])),
      });
    });

    it("keeps a bare `*.md` that carries somebody else's editor, on disk", async () => {
      seedSettings({ "*.md": "someOther.editor" });
      await pick("wysiwyg");
      assert.deepEqual(readAssoc(), {
        "*.md": "someOther.editor",
        ...Object.fromEntries(SCHEME_KEYS.map((k) => [k, "tuiMarkdown.editor"])),
      });
    });

    it("resets markdown associations by removing key from .vscode/settings.json", async () => {
      seedSettings({ "*.md": "default", "*.markdown": "default" });
      const mode = await pick("reset");
      assert.equal(mode, "reset");
      assert.equal(readAssoc(), undefined);
    });
  });
});