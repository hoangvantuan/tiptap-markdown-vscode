import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import katex from "katex";
import * as vscode from "vscode";
import { getMathMacros, handleConfigurationChange } from "../src/host/config";
import {
  buildKatexOptions,
  getMathMacros as getWebviewMacros,
  registerMathView,
  setMathMacros,
} from "../src/webview/math-extension";
import { setWorkspaceRoot, resetStub } from "./vscode-stub";

/**
 * The `markdown.math.macros` table (#179).
 *
 * The host reads VS Code's own setting and hands it to the webview, which
 * passes it to KaTeX. Two things have to hold: the table reaches KaTeX, and
 * it does not leak from one formula into the next (KaTeX writes `\gdef`
 * definitions into the object it is given).
 */

/**
 * KaTeX renders a formula it cannot parse in red, without the message text.
 */
const KATEX_ERROR = /color:#cc0000/;

function writeSettings(dir: string, settings: Record<string, unknown>): void {
  fs.mkdirSync(path.join(dir, ".vscode"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".vscode", "settings.json"),
    JSON.stringify(settings, null, 2),
    "utf8",
  );
}

function fakeDocument(dir: string): vscode.TextDocument {
  return {
    uri: vscode.Uri.file(path.join(dir, "doc.md")),
    languageId: "markdown",
  } as unknown as vscode.TextDocument;
}

describe("markdown.math.macros — the host side (#179)", () => {
  let tmpDir: string;

  beforeEach(() => {
    resetStub();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tuimd-macros-test-"));
    setWorkspaceRoot(tmpDir);
  });

  afterEach(() => {
    resetStub();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore cleanup error */
    }
  });

  it("reads VS Code's own markdown.math.macros setting", () => {
    writeSettings(tmpDir, {
      "markdown.math.macros": { "\\RR": "\\mathbb{R}", "\\NN": "\\mathbb{N}" },
    });

    assert.deepEqual(getMathMacros(fakeDocument(tmpDir)), {
      "\\RR": "\\mathbb{R}",
      "\\NN": "\\mathbb{N}",
    });
  });

  it("returns an empty table when the setting is absent", () => {
    writeSettings(tmpDir, { "editor.fontSize": 14 });

    assert.deepEqual(getMathMacros(fakeDocument(tmpDir)), {});
  });

  it("drops entries that are not strings", () => {
    writeSettings(tmpDir, {
      "markdown.math.macros": {
        "\\RR": "\\mathbb{R}",
        "\\BAD": 42,
        "\\ALSOBAD": { nested: true },
        "\\NULL": null,
      },
    });

    assert.deepEqual(getMathMacros(fakeDocument(tmpDir)), { "\\RR": "\\mathbb{R}" });
  });

  it("drops a definition that is too long", () => {
    writeSettings(tmpDir, {
      "markdown.math.macros": {
        "\\SHORT": "x",
        "\\LONG": "y".repeat(2001),
      },
    });

    assert.deepEqual(getMathMacros(fakeDocument(tmpDir)), { "\\SHORT": "x" });
  });

  it("caps the number of macros", () => {
    const macros: Record<string, string> = {};
    for (let i = 0; i < 600; i++) macros[`\\M${i}`] = "x";
    writeSettings(tmpDir, { "markdown.math.macros": macros });

    const result = getMathMacros(fakeDocument(tmpDir));
    assert.equal(Object.keys(result).length, 500);
  });

  it("re-sends the config when the macro table changes", () => {
    const document = fakeDocument(tmpDir);
    let sent = 0;
    const event = {
      affectsConfiguration: (key: string) => key === "markdown.math.macros",
    } as unknown as vscode.ConfigurationChangeEvent;

    handleConfigurationChange(event, document, () => {
      sent++;
    });

    assert.equal(sent, 1);
  });

  it("does not re-send the config for an unrelated setting", () => {
    const document = fakeDocument(tmpDir);
    let sent = 0;
    const event = {
      affectsConfiguration: (key: string) => key === "editor.wordWrap",
    } as unknown as vscode.ConfigurationChangeEvent;

    handleConfigurationChange(event, document, () => {
      sent++;
    });

    assert.equal(sent, 0);
  });
});

describe("markdown.math.macros — the webview side (#179)", () => {
  beforeEach(() => {
    setMathMacros({});
  });

  it("renders a macro from the table", () => {
    setMathMacros({ "\\RR": "\\mathbb{R}" });

    const html = katex.renderToString("\\RR", buildKatexOptions(false));

    assert.doesNotMatch(html, KATEX_ERROR);
    assert.match(html, /mathbb/);
  });

  it("keeps a \\gdef in one formula out of the next one", () => {
    setMathMacros({ "\\RR": "\\mathbb{R}" });

    katex.renderToString("\\gdef\\leaked{X}", buildKatexOptions(false));

    assert.deepEqual(
      getWebviewMacros(),
      { "\\RR": "\\mathbb{R}" },
      "KaTeX must not write \\gdef definitions into the shared table",
    );
    const html = katex.renderToString("\\leaked", buildKatexOptions(false));
    assert.match(html, KATEX_ERROR, "the macro must not survive into the next render");
  });

  it("keeps a \\gdef out of the NEXT render of the same formula", () => {
    setMathMacros({});

    const first = katex.renderToString("\\gdef\\leaked{X}", buildKatexOptions(false));
    const second = katex.renderToString("\\leaked", buildKatexOptions(false));

    assert.doesNotMatch(first, KATEX_ERROR);
    assert.match(second, KATEX_ERROR, "the macro must not survive into the next render");
  });

  it("hands KaTeX a copy of the table, not the table itself", () => {
    setMathMacros({ "\\RR": "\\mathbb{R}" });

    const options = buildKatexOptions(false);
    options.macros!["\\RR"] = "mutated";
    options.macros!["\\EXTRA"] = "added";

    assert.deepEqual(getWebviewMacros(), { "\\RR": "\\mathbb{R}" });
  });

  it("re-renders the live formulas when the table changes", () => {
    let renders = 0;
    const unregister = registerMathView({
      rerender: () => {
        renders++;
      },
    });

    setMathMacros({ "\\RR": "\\mathbb{R}" });
    assert.equal(renders, 1, "a changed table must reach the formulas on screen");

    setMathMacros({ "\\RR": "\\mathbb{R}" });
    assert.equal(renders, 1, "an unchanged table must not re-render anything");

    unregister();
    setMathMacros({ "\\RR": "\\mathbb{N}" });
    assert.equal(renders, 1, "a destroyed formula must not be re-rendered");
  });

  it("bounds the expansion of a self-referential macro", () => {
    setMathMacros({ "\\LOOP": "\\LOOP" });

    const options = buildKatexOptions(false);
    assert.equal(options.maxExpand, 1000, "the expansion limit must be explicit");

    const html = katex.renderToString("\\LOOP", options);
    assert.match(html, KATEX_ERROR, "a self-referential macro must fail, not expand forever");
  });
});
