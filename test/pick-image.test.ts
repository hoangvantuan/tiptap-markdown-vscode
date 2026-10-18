/**
 * #173 `pickImage`: the host reads the picked file and saves it through
 * `writeImage`; the webview only ever sees the saved path. Dependencies are
 * injected, so the dialog, the filesystem and `writeImage` are fakes and what
 * is asserted is the host's own decisions.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as vscode from "vscode";
import {
  handlePickImage,
  pickedImageNames,
  PICKED_IMAGE_MAX_BYTES,
  type PickImageDeps,
} from "../src/host/pickImage";

const doc = { uri: vscode.Uri.file("/ws/docs/index.md") } as unknown as vscode.TextDocument;

function harness(overrides: Partial<PickImageDeps> = {}) {
  const posted: any[] = [];
  const warnings: string[] = [];
  const written: Array<{ filename: string; bytes: Uint8Array }> = [];
  const reads: string[] = [];
  const webview = {
    postMessage: (m: unknown) => {
      posted.push(m);
      return Promise.resolve(true);
    },
    asWebviewUri: (u: vscode.Uri) => ({ toString: () => `webview:${u.path}` }),
  } as any;
  const deps: PickImageDeps = {
    showOpenDialog: async () => [vscode.Uri.file("/elsewhere/My Photo.PNG")],
    stat: async () => ({ size: 10 }),
    readFile: async (u) => {
      reads.push(u.path);
      return new Uint8Array([1, 2, 3]);
    },
    writeImage: async (_d, filename, bytes) => {
      written.push({ filename, bytes });
      // `writeImage` applies `imageFileNameTemplate`, collision suffixes (-2)
      // and magic-byte extension correction, so its returned path deliberately
      // differs from the suggested `filename`.
      return {
        fileUri: vscode.Uri.file("/ws/docs/images/My Photo-2.webp"),
        relativePath: "images/My Photo-2.webp",
      };
    },
    showWarningMessage: (m) => warnings.push(m),
    ...overrides,
  };
  return { posted, warnings, written, reads, webview, deps };
}

describe("pickImage host handler (#173)", () => {
  it("saves the picked file's bytes and replies with writeImage's returned relativePath", async () => {
    const h = harness();
    await handlePickImage({ type: "pickImage", requestId: "r1" }, doc, h.webview, h.deps);
    assert.equal(h.written.length, 1);
    assert.equal(h.written[0].filename, "My Photo.png");
    assert.deepEqual(Array.from(h.written[0].bytes), [1, 2, 3]);
    assert.equal(h.posted.length, 1);
    const reply = h.posted[0];
    assert.equal(reply.type, "imagePicked");
    assert.equal(reply.requestId, "r1");
    assert.equal(reply.savedPath, "images/My Photo-2.webp");
    assert.equal(reply.webviewUri, "webview:/ws/docs/images/My Photo-2.webp");
    assert.equal(reply.alt, "My Photo");
    // The bytes stay on the host: nothing in the reply carries them.
    assert.equal(JSON.stringify(reply).includes("data:"), false);
  });

  it("a cancelled dialog reads nothing, writes nothing and still answers", async () => {
    const h = harness({ showOpenDialog: async () => undefined });
    await handlePickImage({ type: "pickImage", requestId: "r2" }, doc, h.webview, h.deps);
    assert.equal(h.reads.length, 0);
    assert.equal(h.written.length, 0);
    assert.deepEqual(h.posted, [{ type: "imagePicked", requestId: "r2" }]);
    assert.equal(h.warnings.length, 0);
  });

  it("refuses a file over the size cap without reading it", async () => {
    const h = harness({ stat: async () => ({ size: PICKED_IMAGE_MAX_BYTES + 1 }) });
    await handlePickImage({ type: "pickImage", requestId: "r3" }, doc, h.webview, h.deps);
    assert.equal(h.reads.length, 0);
    assert.equal(h.written.length, 0);
    assert.equal(h.warnings.length, 1);
    assert.deepEqual(h.posted, [{ type: "imagePicked", requestId: "r3" }]);
  });

  it("refuses a file that is not a known image type", async () => {
    const h = harness({
      showOpenDialog: async () => [vscode.Uri.file("/elsewhere/notes.txt")],
    });
    await handlePickImage({ type: "pickImage", requestId: "r4" }, doc, h.webview, h.deps);
    assert.equal(h.written.length, 0);
    assert.equal(h.warnings.length, 1);
    assert.deepEqual(h.posted, [{ type: "imagePicked", requestId: "r4" }]);
  });

  it("answers without a path when writeImage rejects", async () => {
    const h = harness({ writeImage: async () => undefined });
    await handlePickImage({ type: "pickImage", requestId: "r5" }, doc, h.webview, h.deps);
    assert.deepEqual(h.posted, [{ type: "imagePicked", requestId: "r5" }]);
  });

  it("answers without a path when reading throws", async () => {
    const h = harness({
      readFile: async () => {
        throw new Error("EACCES");
      },
    });
    await handlePickImage({ type: "pickImage", requestId: "r6" }, doc, h.webview, h.deps);
    assert.deepEqual(h.posted, [{ type: "imagePicked", requestId: "r6" }]);
    assert.equal(h.warnings.length, 1);
  });
});

describe("pickedImageNames", () => {
  it("keeps the name readable and lowercases the extension", () => {
    assert.deepEqual(pickedImageNames("My Photo.PNG"), {
      alt: "My Photo",
      filename: "My Photo.png",
    });
  });

  it("replaces characters writeImage would reject instead of failing", () => {
    const n = pickedImageNames('a:b?"c.jpg');
    assert.equal(n?.filename, "a-b--c.jpg");
  });

  it("prefixes Windows reserved device names so writeImage does not reject them", () => {
    const n = pickedImageNames("CON.png");
    assert.equal(n?.filename, "_CON.png");
  });

  it("never yields a traversal", () => {
    const n = pickedImageNames("..bad...png");
    assert.equal(n?.filename.includes(".."), false);
  });

  it("rejects an extension that is not an image", () => {
    assert.equal(pickedImageNames("notes.txt"), undefined);
    assert.equal(pickedImageNames(".png"), undefined);
  });
});
