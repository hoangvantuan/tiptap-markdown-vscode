/**
 * `downloadRemoteImages` (#174): on an opt-in basis, fetch the `https:` images
 * of pasted HTML into the image folder so the document does not depend on a
 * remote URL staying alive.
 *
 * Why this is a host job guarded by a setting, not a webview feature:
 *
 * - The URLs come from the clipboard, i.e. from whatever page the user copied.
 *   Fetching them is the extension making requests on a stranger's say-so, so it
 *   is off by default and read from the setting at the moment of the paste. With
 *   the setting off this function returns before it touches the network, and the
 *   paste behaves as it always did (the webview only reports which URLs it saw).
 * - The webview sandbox cannot fetch cross-origin and should not hold the bytes;
 *   the host fetches with the limits of `src/utils/remote-fetch.ts` (https only,
 *   size cap, timeout, must answer as an image) and saves through `writeImage`,
 *   the same guarded path as every other image source.
 *
 * Failure is per image and never fatal. Anything behind auth or cookies (401,
 * 403), gone (404), too large, or not an image keeps its remote URL in the
 * document: it is simply absent from the reply. Only the images that really
 * landed on disk are reported, one `remoteImagesDownloaded` per image so a slow
 * server does not hold back the fast ones.
 */
import * as vscode from "vscode";
import type { DownloadRemoteImagesMessage } from "../shared/messages";
import type { TypedWebview } from "./typedWebview";
import { writeImage } from "./saveImage";
import { getDownloadRemoteImagesOnPaste } from "./config";
import { fetchRemoteBytes, type RemoteFetchResult } from "../utils/remote-fetch";

/** A page with hundreds of images must not become hundreds of requests. */
export const MAX_REMOTE_IMAGES_PER_PASTE = 50;
const CONCURRENCY = 3;

/** content-type subtype -> file extension, for the types the editor displays. */
const EXTENSION_FOR_SUBTYPE: Record<string, string> = {
  png: "png",
  jpeg: "jpg",
  jpg: "jpg",
  gif: "gif",
  webp: "webp",
  "svg+xml": "svg",
  bmp: "bmp",
  avif: "avif",
};

export interface DownloadRemoteImagesDeps {
  isEnabled: (document: vscode.TextDocument) => boolean;
  fetchBytes: (url: string) => Promise<RemoteFetchResult>;
  writeImage: typeof writeImage;
  setStatus: (text: string) => void;
}

const defaultDeps: DownloadRemoteImagesDeps = {
  isEnabled: (d) => getDownloadRemoteImagesOnPaste(d),
  fetchBytes: (url) =>
    fetchRemoteBytes(url, { httpsOnly: true, requireImageContentType: true }),
  writeImage,
  setStatus: (text) => {
    vscode.window.setStatusBarMessage(text, 6000);
  },
};

/**
 * The URLs worth fetching: `https:` only, parseable, de-duplicated, capped.
 * `http:`, `data:`, relative and everything else is dropped here, before the
 * fetch layer's own https check, so the rule exists once at the entry.
 */
export function selectDownloadableUrls(urls: unknown): string[] {
  if (!Array.isArray(urls)) return [];
  const out: string[] = [];
  for (const u of urls) {
    if (typeof u !== "string" || u.length > 2048) continue;
    let parsed: URL;
    try {
      parsed = new URL(u);
    } catch {
      continue;
    }
    if (parsed.protocol !== "https:") continue;
    if (!out.includes(u)) out.push(u);
    if (out.length >= MAX_REMOTE_IMAGES_PER_PASTE) break;
  }
  return out;
}

/** `image-<time>-<random>.<ext>`, or undefined for a type we do not know. */
export function remoteImageFilename(
  contentType: string,
  unique: string,
): string | undefined {
  const subtype = contentType.split(";")[0].split("/")[1]?.trim().toLowerCase();
  const ext = subtype ? EXTENSION_FOR_SUBTYPE[subtype] : undefined;
  return ext ? `image-${unique}.${ext}` : undefined;
}

export async function handleDownloadRemoteImages(
  msg: DownloadRemoteImagesMessage,
  document: vscode.TextDocument,
  webview: TypedWebview,
  deps: DownloadRemoteImagesDeps = defaultDeps,
): Promise<void> {
  // The gate comes before anything else, so "off" provably means "no request".
  if (!deps.isEnabled(document)) return;

  const urls = selectDownloadableUrls(msg.urls);
  if (urls.length === 0) return;

  let failed = 0;
  const queue = [...urls];

  const downloadOne = async (url: string): Promise<void> => {
    try {
      const { bytes, contentType } = await deps.fetchBytes(url);
      const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const filename = remoteImageFilename(contentType, unique);
      if (!filename) throw new Error(`Unsupported image type "${contentType}": ${url}`);
      const saved = await deps.writeImage(document, filename, bytes);
      if (!saved) {
        // writeImage has already reported why.
        failed++;
        return;
      }
      await webview.postMessage({
        type: "remoteImagesDownloaded",
        images: [
          {
            url,
            savedPath: saved.relativePath,
            webviewUri: webview.asWebviewUri(saved.fileUri).toString(),
          },
        ],
      });
    } catch (err) {
      failed++;
      console.warn(
        "[Remote Images] Kept remote URL:",
        url,
        err instanceof Error ? err.message : String(err),
      );
    }
  };

  const worker = async (): Promise<void> => {
    for (let url = queue.shift(); url !== undefined; url = queue.shift()) {
      await downloadOne(url);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, urls.length) }, worker),
  );

  if (failed > 0) {
    deps.setStatus(
      `${failed} of ${urls.length} pasted image${urls.length === 1 ? "" : "s"} could not be downloaded; the remote link${failed === 1 ? " was" : "s were"} kept.`,
    );
  }
}
