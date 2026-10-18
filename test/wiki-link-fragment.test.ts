/**
 * `[[Note#Heading]]` resolves Note.md and never offers to create a file with a
 * `#` in its name (#170).
 *
 * Three layers, because the bug crossed all three:
 * 1. what the wiki link tokenizer hands the host for each spelling (it keeps
 *    the fragment inside `filename`, which is what the file must keep);
 * 2. `splitWikiTarget`, the pure split the host applies before resolving;
 * 3. `openWikiLink` end to end through the vscode stub, on real files.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { openWikiLink, splitWikiTarget } from "../src/host/openWikiLink";
import { WikiLink } from "../src/webview/wiki-link-plugin";
import {
  setWorkspaceRoot,
  getWarningCalls,
  getExecutedCommands,
  resetStub,
} from "./vscode-stub";

interface WikiToken {
  filename: string;
  alias: string | null;
}

function tokenize(src: string): WikiToken | undefined {
  const tokenizer = (WikiLink.config as any).markdownTokenizer;
  return tokenizer.tokenize(src) as WikiToken | undefined;
}

describe("wiki link tokenizer keeps the fragment in filename (#170)", () => {
  it("[[Note#Heading]] arrives as filename Note#Heading", () => {
    const token = tokenize("[[Note#Heading]]");
    assert.equal(token?.filename, "Note#Heading");
    assert.equal(token?.alias, null);
  });

  it("[[Note#Heading|alias]] arrives as filename Note#Heading, alias apart", () => {
    const token = tokenize("[[Note#Heading|alias]]");
    assert.equal(token?.filename, "Note#Heading");
    assert.equal(token?.alias, "alias");
  });

  it("[[Note#^abc]] arrives as filename Note#^abc", () => {
    assert.equal(tokenize("[[Note#^abc]]")?.filename, "Note#^abc");
  });
});

describe("splitWikiTarget (#170)", () => {
  it("splits a heading fragment off the file part", () => {
    assert.deepEqual(splitWikiTarget("Note#Heading"), { name: "Note", fragment: "Heading" });
  });

  it("splits a block reference off the file part", () => {
    assert.deepEqual(splitWikiTarget("Note#^abc"), { name: "Note", fragment: "^abc" });
  });

  it("keeps spaces inside the heading text and trims around the #", () => {
    assert.deepEqual(splitWikiTarget(" My Note # My Heading "), {
      name: "My Note",
      fragment: "My Heading",
    });
  });

  it("splits at the FIRST #, so a nested fragment stays whole", () => {
    assert.deepEqual(splitWikiTarget("sub/Note#A#B"), { name: "sub/Note", fragment: "A#B" });
  });

  it("a target that is all fragment has an empty file part", () => {
    assert.deepEqual(splitWikiTarget("#Heading"), { name: "", fragment: "Heading" });
  });

  it("no # means no fragment, and an empty fragment is none", () => {
    assert.deepEqual(splitWikiTarget("Note"), { name: "Note", fragment: null });
    assert.deepEqual(splitWikiTarget("Note#"), { name: "Note", fragment: null });
  });
});

describe("openWikiLink with a fragment (#170)", () => {
  let tmpDir: string;
  let docDir: string;
  let docUri: vscode.Uri;

  beforeEach(() => {
    resetStub();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tuimd-wiki-fragment-test-"));
    docDir = path.join(tmpDir, "docs");
    fs.mkdirSync(docDir, { recursive: true });
    const docPath = path.join(docDir, "index.md");
    fs.writeFileSync(docPath, "# Index\n", "utf8");
    docUri = vscode.Uri.file(docPath);
    setWorkspaceRoot(tmpDir);
  });

  afterEach(() => {
    resetStub();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function assertOpenedOnly(expectedPath: string): void {
    const cmds = getExecutedCommands();
    assert.equal(cmds.length, 1, `exactly one open, got ${JSON.stringify(cmds.map((c) => c.command))}`);
    assert.equal(cmds[0].command, "vscode.open");
    assert.equal(cmds[0].args[0].fsPath, expectedPath);
    assert.deepEqual(getWarningCalls(), [], "no create prompt, no warning");
  }

  // Each spelling goes through the tokenizer first, so the host is handed
  // exactly the string a click would hand it, alias form included.
  for (const source of ["[[Note#Heading]]", "[[Note#Heading|alias]]", "[[Note#^abc]]"]) {
    it(`${source} opens Note.md and prompts for nothing`, async () => {
      const notePath = path.join(docDir, "Note.md");
      fs.writeFileSync(notePath, "# Heading\n", "utf8");
      const filename = tokenize(source)!.filename;

      const opened = await openWikiLink(filename, docUri);

      assert.equal(opened?.fsPath, notePath);
      assertOpenedOnly(notePath);
    });
  }

  it("a note found only by the workspace scan still resolves without the fragment", async () => {
    // `my note.md` is not matched by either glob candidate for `My Note`
    // (case differs), so this goes through the third, basename-scan step.
    const notePath = path.join(tmpDir, "elsewhere", "my note.md");
    fs.mkdirSync(path.dirname(notePath), { recursive: true });
    fs.writeFileSync(notePath, "# Section\n", "utf8");

    const opened = await openWikiLink("My Note#Section", docUri);

    assert.equal(opened?.fsPath, notePath);
    assertOpenedOnly(notePath);
  });

  it("a missing target offers to create Note.md, never Note#Heading.md", async () => {
    const opened = await openWikiLink("Missing#Heading", docUri);

    const warnings = getWarningCalls();
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].message.includes(`"Missing.md"`), warnings[0].message);
    assert.ok(!warnings[0].message.includes("#"), `prompt must not name a # file: ${warnings[0].message}`);
    assert.equal(opened?.fsPath, path.join(docDir, "Missing.md"));
    assert.equal(fs.existsSync(path.join(docDir, "Missing.md")), true);
    assert.deepEqual(
      fs.readdirSync(docDir).filter((f) => f.includes("#")),
      [],
      "no file with # in its name was created",
    );
  });

  it("[[#Heading]] names the current document: no lookup, no prompt, no open", async () => {
    const opened = await openWikiLink("#Heading", docUri);

    assert.equal(opened, undefined);
    assert.deepEqual(getExecutedCommands(), []);
    assert.deepEqual(getWarningCalls(), []);
    assert.deepEqual(fs.readdirSync(docDir).sort(), ["index.md"]);
  });
});
