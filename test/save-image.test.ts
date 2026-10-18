/**
 * `writeImage` end to end through the vscode stub (#172, #177): what lands on
 * disk, under what name, and what the auto-rename / auto-delete machinery
 * (ImageLedger, detectImageDeletes) makes of a per-document image folder.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { writeImage } from "../src/host/saveImage";
import { ImageLedger } from "../src/host/imageLedger";
import { extractImagePaths } from "../src/host/imagePaths";
import { detectImageDeletes } from "../src/utils/image-rename-handler";
import { setWorkspaceRoot, resetStub } from "./vscode-stub";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const WEBP = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]);

describe("writeImage (#172, #177)", () => {
  let tmpDir: string;

  beforeEach(() => {
    resetStub();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tuimd-write-image-"));
    setWorkspaceRoot(tmpDir);
  });

  afterEach(() => {
    resetStub();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function settings(values: Record<string, string>): void {
    fs.mkdirSync(path.join(tmpDir, ".vscode"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".vscode", "settings.json"), JSON.stringify(values));
  }

  function docNamed(name: string): vscode.TextDocument {
    return { uri: vscode.Uri.file(path.join(tmpDir, name)) } as unknown as vscode.TextDocument;
  }

  /** Every file under tmpDir except settings, as posix paths relative to it. */
  function filesOnDisk(): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name !== ".vscode") walk(full);
        } else {
          out.push(path.relative(tmpDir, full).split(path.sep).join("/"));
        }
      }
    };
    walk(tmpDir);
    return out.sort();
  }

  describe("defaults keep today's behaviour", () => {
    it("saves as images/image-<now>-<6 base36>.<ext>", async () => {
      const before = Date.now();
      const saved = await writeImage(docNamed("note.md"), "image-1-abc.png", PNG);
      assert.ok(saved);
      assert.match(saved.relativePath, /^images\/image-\d+-[0-9a-z]{6}\.png$/);
      const stamp = Number(/image-(\d+)-/.exec(saved.relativePath)![1]);
      assert.ok(stamp >= before && stamp <= Date.now());
      assert.deepEqual(fs.readFileSync(saved.fileUri.fsPath), Buffer.from(PNG));
      assert.equal(saved.fileUri.fsPath, path.join(tmpDir, saved.relativePath));
    });

    it("blank settings fall back to the defaults", async () => {
      settings({ "tuiMarkdown.imageSaveFolder": "  ", "tuiMarkdown.imageFileNameTemplate": "" });
      const saved = await writeImage(docNamed("note.md"), "x.png", PNG);
      assert.match(saved!.relativePath, /^images\/image-\d+-[0-9a-z]{6}\.png$/);
    });

    it("'.' still means the document folder", async () => {
      settings({ "tuiMarkdown.imageSaveFolder": "." });
      const saved = await writeImage(docNamed("note.md"), "x.png", PNG);
      assert.match(saved!.relativePath, /^image-\d+-[0-9a-z]{6}\.png$/);
    });
  });

  describe("templates", () => {
    it("expands variables in the folder: images/${fileName}", async () => {
      settings({ "tuiMarkdown.imageSaveFolder": "images/${fileName}" });
      const saved = await writeImage(docNamed("My Note.md"), "x.png", PNG);
      assert.match(saved!.relativePath, /^images\/My Note\/image-\d+-[0-9a-z]{6}\.png$/);
      assert.equal(fs.existsSync(path.join(tmpDir, saved!.relativePath)), true);
    });

    it("expands variables in the file name, and does not double the extension", async () => {
      settings({ "tuiMarkdown.imageFileNameTemplate": "${fileName}-${date}-${uuid}.${ext}" });
      const saved = await writeImage(docNamed("note.md"), "x.png", PNG);
      assert.match(
        saved!.relativePath,
        /^images\/note-\d{4}-\d{2}-\d{2}-[0-9a-f-]{36}\.png$/,
      );
    });

    it("${name} carries the stem of the suggested name", async () => {
      settings({ "tuiMarkdown.imageFileNameTemplate": "${name}" });
      const saved = await writeImage(docNamed("note.md"), "holiday photo.jpg", JPEG);
      assert.equal(saved!.relativePath, "images/holiday photo.jpg");
    });

    it("trailing slash in the folder does not leave a double slash", async () => {
      settings({ "tuiMarkdown.imageSaveFolder": "pics/" });
      const saved = await writeImage(docNamed("note.md"), "x.png", PNG);
      assert.match(saved!.relativePath, /^pics\/image-/);
    });

    it("a document name with `..` and `:` stays inside the document folder", async () => {
      settings({ "tuiMarkdown.imageSaveFolder": "images/${fileName}" });
      const saved = await writeImage(docNamed("we..ird:na me.md"), "x.png", PNG);
      assert.ok(saved);
      assert.match(saved.relativePath, /^images\/we_ird_na me\/image-/);
      assert.equal(saved.relativePath.includes(".."), false);
      const rel = path.relative(tmpDir, saved.fileUri.fsPath);
      assert.equal(rel.startsWith(".."), false);
      assert.equal(filesOnDisk().length, 1);
    });

    it("a document named like a Windows device gets a safe folder", async () => {
      settings({ "tuiMarkdown.imageSaveFolder": "images/${fileName}" });
      const saved = await writeImage(docNamed("CON.md"), "x.png", PNG);
      assert.match(saved!.relativePath, /^images\/_CON\//);
    });
  });

  describe("guards run on the expanded value", () => {
    async function rejected(doc: string, hint = "x.png"): Promise<void> {
      const saved = await writeImage(docNamed(doc), hint, PNG);
      assert.equal(saved, undefined);
      assert.deepEqual(filesOnDisk(), [], "nothing may reach disk");
    }

    it("folder template that climbs out", async () => {
      settings({ "tuiMarkdown.imageSaveFolder": "../${fileName}" });
      await rejected("note.md");
    });

    it("folder template that is absolute", async () => {
      settings({ "tuiMarkdown.imageSaveFolder": "/tmp/${fileName}" });
      await rejected("note.md");
    });

    it("${workspaceDir} is not a variable", async () => {
      settings({ "tuiMarkdown.imageSaveFolder": "${workspaceDir}/images" });
      await rejected("note.md");
    });

    it("unknown variable in the file name template", async () => {
      settings({ "tuiMarkdown.imageFileNameTemplate": "${filename}" });
      await rejected("note.md");
    });

    it("file name template that spells a separator", async () => {
      settings({ "tuiMarkdown.imageFileNameTemplate": "sub/${now}" });
      await rejected("note.md");
    });

    it("file name template that spells `..`", async () => {
      settings({ "tuiMarkdown.imageFileNameTemplate": "a..${now}" });
      await rejected("note.md");
    });

    it("file name template that is a Windows device name", async () => {
      settings({ "tuiMarkdown.imageFileNameTemplate": "CON" });
      await rejected("note.md");
    });

    it("a hostile suggested name", async () => {
      await rejected("note.md", "../evil.png");
      await rejected("note.md", "a/b.png");
    });
  });

  describe("collisions", () => {
    it("does not overwrite: a taken name gets -2, -3", async () => {
      settings({ "tuiMarkdown.imageFileNameTemplate": "fixed" });
      const a = await writeImage(docNamed("note.md"), "x.png", PNG);
      const b = await writeImage(docNamed("note.md"), "x.png", WEBP);
      const c = await writeImage(docNamed("note.md"), "x.png", PNG);
      assert.equal(a!.relativePath, "images/fixed.png");
      assert.equal(b!.relativePath, "images/fixed.webp"); // different ext: no clash
      assert.equal(c!.relativePath, "images/fixed-2.png");
      assert.deepEqual(filesOnDisk(), ["images/fixed-2.png", "images/fixed.png", "images/fixed.webp"]);
    });

    it("saves made at the same time do not pick the same name", async () => {
      settings({ "tuiMarkdown.imageFileNameTemplate": "fixed" });
      const all = await Promise.all(
        [1, 2, 3, 4, 5].map(() => writeImage(docNamed("note.md"), "x.png", PNG)),
      );
      const names = all.map((s) => s!.relativePath);
      assert.equal(new Set(names).size, 5, names.join(","));
      assert.equal(filesOnDisk().length, 5);
    });
  });

  describe("extension from the bytes (#177)", () => {
    it("WebP bytes named .png are saved as .webp", async () => {
      const saved = await writeImage(docNamed("note.md"), "image-1-abc.png", WEBP);
      assert.match(saved!.relativePath, /\.webp$/);
      assert.match(saved!.fileUri.fsPath, /\.webp$/);
    });

    it("a correct .jpeg is kept", async () => {
      settings({ "tuiMarkdown.imageFileNameTemplate": "p" });
      const saved = await writeImage(docNamed("note.md"), "x.jpeg", JPEG);
      assert.equal(saved!.relativePath, "images/p.jpeg");
    });

    it("unrecognised bytes keep the suggested extension", async () => {
      settings({ "tuiMarkdown.imageFileNameTemplate": "p" });
      const saved = await writeImage(docNamed("note.md"), "x.bmp", new TextEncoder().encode("BM....."));
      assert.equal(saved!.relativePath, "images/p.bmp");
    });

    it("the corrected extension is what ${ext} expands to", async () => {
      settings({ "tuiMarkdown.imageFileNameTemplate": "p-${ext}" });
      const saved = await writeImage(docNamed("note.md"), "x.png", WEBP);
      assert.equal(saved!.relativePath, "images/p-webp");
    });
  });

  describe("a per-document folder and the auto-rename / auto-delete machinery", () => {
    const FOLDER = { "tuiMarkdown.imageSaveFolder": "images/${fileName}" };

    it("renaming an image inside images/${fileName} is detected as a rename", async () => {
      settings(FOLDER);
      const doc = docNamed("note.md");
      const saved = await writeImage(doc, "x.png", PNG);
      assert.ok(saved);
      const dir = path.posix.dirname(saved.relativePath);
      assert.equal(dir, "images/note");

      const ledger = new ImageLedger(`![a](${saved.relativePath})\n`, doc.uri);
      const edited = `![a](${dir}/renamed.png)\n`;
      const renames = ledger.detectRenames(edited, doc.uri);

      assert.equal(renames.length, 1);
      assert.equal(renames[0].oldRelative, saved.relativePath);
      assert.equal(renames[0].newRelative, `${dir}/renamed.png`);
      assert.equal(renames[0].oldAbsolute, saved.fileUri.fsPath);
      assert.equal(renames[0].newAbsolute, path.join(tmpDir, dir, "renamed.png"));
    });

    it("renaming works when the document name has a space (path wrapped in <>)", async () => {
      settings(FOLDER);
      const doc = docNamed("My Note.md");
      const saved = await writeImage(doc, "x.png", PNG);
      assert.ok(saved);
      const dir = path.posix.dirname(saved.relativePath);
      assert.equal(dir, "images/My Note");

      const ledger = new ImageLedger(`![a](<${saved.relativePath}>)\n`, doc.uri);
      assert.equal(ledger.getBaseline().has(saved.relativePath), true);
      const renames = ledger.detectRenames(`![a](<${dir}/new name.png>)\n`, doc.uri);
      assert.equal(renames.length, 1);
      assert.equal(renames[0].newRelative, `${dir}/new name.png`);
    });

    it("moving the image to another folder is NOT a rename (the existing rule still holds)", async () => {
      settings(FOLDER);
      const doc = docNamed("note.md");
      const saved = await writeImage(doc, "x.png", PNG);
      const ledger = new ImageLedger(`![a](${saved!.relativePath})\n`, doc.uri);
      assert.deepEqual(ledger.detectRenames("![a](images/other/renamed.png)\n", doc.uri), []);
    });

    it("removing the image from the markdown is detected as a delete", async () => {
      settings(FOLDER);
      const doc = docNamed("note.md");
      const saved = await writeImage(doc, "x.png", PNG);
      assert.ok(saved);

      const ledger = new ImageLedger(`![a](${saved.relativePath})\n`, doc.uri);
      const current = extractImagePaths("# Note\n\nnothing here\n");
      const deletes = ledger.detectDeletes(ledger.getBaseline() as Map<string, string>, current);

      assert.equal(deletes.length, 1);
      assert.equal(deletes[0].relativePath, saved.relativePath);
      assert.equal(deletes[0].absolutePath, saved.fileUri.fsPath);
    });

    it("two documents sharing a template keep separate folders, so one's delete never reads as a move", async () => {
      settings(FOLDER);
      const a = await writeImage(docNamed("a.md"), "x.png", PNG);
      const b = await writeImage(docNamed("b.md"), "x.png", PNG);
      assert.equal(path.posix.dirname(a!.relativePath), "images/a");
      assert.equal(path.posix.dirname(b!.relativePath), "images/b");
      const baseline = new Map([[a!.relativePath, a!.fileUri.fsPath]]);
      const deletes = detectImageDeletes(baseline, []);
      assert.equal(deletes.length, 1);
    });
  });
});
