/**
 * #174 `downloadRemoteImages`: opt-in, https only, per-image failure keeps the
 * remote URL. The network is a fake `fetchBytes`; what is asserted is whether
 * it is called at all and what the host reports back.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as vscode from "vscode";
import {
  handleDownloadRemoteImages,
  selectDownloadableUrls,
  remoteImageFilename,
  MAX_REMOTE_IMAGES_PER_PASTE,
  type DownloadRemoteImagesDeps,
} from "../src/host/downloadRemoteImages";

const doc = { uri: vscode.Uri.file("/ws/docs/index.md") } as unknown as vscode.TextDocument;

function harness(overrides: Partial<DownloadRemoteImagesDeps> = {}) {
  const posted: any[] = [];
  const fetched: string[] = [];
  const written: Array<{ filename: string; bytes: Uint8Array }> = [];
  const statuses: string[] = [];
  const webview = {
    postMessage: (m: unknown) => {
      posted.push(m);
      return Promise.resolve(true);
    },
    asWebviewUri: (u: vscode.Uri) => ({ toString: () => `webview:${u.path}` }),
  } as any;
  const deps: DownloadRemoteImagesDeps = {
    isEnabled: () => true,
    fetchBytes: async (url) => {
      fetched.push(url);
      return { bytes: new Uint8Array([9, 9]), contentType: "image/png" };
    },
    writeImage: async (_d, filename, bytes) => {
      written.push({ filename, bytes });
      // `writeImage` expands templates, corrects extensions and adds `-2` on
      // collision, so the returned path deliberately differs from `filename`.
      const finalName = `templated-${written.length}.webp`;
      return {
        fileUri: vscode.Uri.file(`/ws/docs/assets/${finalName}`),
        relativePath: `assets/${finalName}`,
      };
    },
    setStatus: (t) => statuses.push(t),
    ...overrides,
  };
  return { posted, fetched, written, statuses, webview, deps };
}

describe("downloadRemoteImages host handler (#174)", () => {
  it("with the setting off makes no request at all", async () => {
    const h = harness({ isEnabled: () => false });
    await handleDownloadRemoteImages(
      { type: "downloadRemoteImages", urls: ["https://a.test/1.png"] },
      doc,
      h.webview,
      h.deps,
    );
    assert.deepEqual(h.fetched, []);
    assert.deepEqual(h.posted, []);
    assert.deepEqual(h.written, []);
  });

  it("downloads, saves through writeImage and reports url -> writeImage's returned relativePath", async () => {
    const h = harness();
    await handleDownloadRemoteImages(
      { type: "downloadRemoteImages", urls: ["https://a.test/1.png"] },
      doc,
      h.webview,
      h.deps,
    );
    assert.deepEqual(h.fetched, ["https://a.test/1.png"]);
    assert.equal(h.written.length, 1);
    assert.match(h.written[0].filename, /^image-.*\.png$/);
    assert.deepEqual(Array.from(h.written[0].bytes), [9, 9]);
    assert.equal(h.posted.length, 1);
    const img = h.posted[0].images[0];
    assert.equal(h.posted[0].type, "remoteImagesDownloaded");
    assert.equal(img.url, "https://a.test/1.png");
    assert.equal(img.savedPath, "assets/templated-1.webp");
    assert.equal(img.webviewUri, "webview:/ws/docs/assets/templated-1.webp");
  });

  it("a failed image keeps its URL and does not stop the others", async () => {
    const h = harness({
      fetchBytes: async (url) => {
        if (url.endsWith("/bad.png")) throw new Error("Fetch 403");
        return { bytes: new Uint8Array([1]), contentType: "image/jpeg" };
      },
    });
    await handleDownloadRemoteImages(
      {
        type: "downloadRemoteImages",
        urls: ["https://a.test/ok1.png", "https://a.test/bad.png", "https://a.test/ok2.png"],
      },
      doc,
      h.webview,
      h.deps,
    );
    const reported = h.posted.flatMap((m) => m.images.map((i: any) => i.url)).sort();
    assert.deepEqual(reported, ["https://a.test/ok1.png", "https://a.test/ok2.png"]);
    assert.equal(h.statuses.length, 1);
    assert.match(h.statuses[0], /1 of 3/);
  });

  it("an image type it cannot name is kept remote rather than saved as .bin", async () => {
    const h = harness({
      fetchBytes: async () => ({ bytes: new Uint8Array([1]), contentType: "image/x-weird" }),
    });
    await handleDownloadRemoteImages(
      { type: "downloadRemoteImages", urls: ["https://a.test/w"] },
      doc,
      h.webview,
      h.deps,
    );
    assert.equal(h.written.length, 0);
    assert.equal(h.posted.length, 0);
  });

  it("a writeImage rejection keeps the URL", async () => {
    const h = harness({ writeImage: async () => undefined });
    await handleDownloadRemoteImages(
      { type: "downloadRemoteImages", urls: ["https://a.test/1.png"] },
      doc,
      h.webview,
      h.deps,
    );
    assert.equal(h.posted.length, 0);
  });

  it("never fetches a non-https URL, even if the webview sent one", async () => {
    const h = harness();
    await handleDownloadRemoteImages(
      {
        type: "downloadRemoteImages",
        urls: ["http://a.test/1.png", "data:image/png;base64,AA", "file:///etc/passwd", "ftp://a/1.png"],
      },
      doc,
      h.webview,
      h.deps,
    );
    assert.deepEqual(h.fetched, []);
  });
});

describe("selectDownloadableUrls", () => {
  it("keeps https only, de-duplicates, ignores garbage", () => {
    assert.deepEqual(
      selectDownloadableUrls([
        "https://a.test/1.png",
        "https://a.test/1.png",
        "http://a.test/2.png",
        "not a url",
        42,
        null,
        "https://b.test/3.png",
      ]),
      ["https://a.test/1.png", "https://b.test/3.png"],
    );
    assert.deepEqual(selectDownloadableUrls("https://a.test/1.png"), []);
  });

  it("caps how many one paste may fetch", () => {
    const many = Array.from({ length: 200 }, (_, i) => `https://a.test/${i}.png`);
    assert.equal(selectDownloadableUrls(many).length, MAX_REMOTE_IMAGES_PER_PASTE);
  });
});

describe("remoteImageFilename", () => {
  it("maps the content type to an extension", () => {
    assert.equal(remoteImageFilename("image/jpeg", "u"), "image-u.jpg");
    assert.equal(remoteImageFilename("image/svg+xml; charset=utf-8", "u"), "image-u.svg");
    assert.equal(remoteImageFilename("image/PNG", "u"), "image-u.png");
  });
  it("returns undefined for a type it does not know", () => {
    assert.equal(remoteImageFilename("image/x-weird", "u"), undefined);
    assert.equal(remoteImageFilename("text/html", "u"), undefined);
    assert.equal(remoteImageFilename("", "u"), undefined);
  });
});
