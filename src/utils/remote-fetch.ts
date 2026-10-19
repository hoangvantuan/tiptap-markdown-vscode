/**
 * Size- and time-limited fetch of a remote image, shared by the DOCX export
 * (src/utils/export-docx.ts) and the opt-in download of pasted remote images
 * (src/host/downloadRemoteImages.ts, #174).
 *
 * Extension-host side only (uses global `fetch`, Node 18+ / VS Code's Electron).
 *
 * Two limits apply and both are enforced, because neither is enough alone:
 * the declared `content-length` rejects an oversized body before a byte of it
 * is read, and the byte count while reading rejects one that lied or sent no
 * length at all (chunked). The body is read as a stream and the request is
 * aborted at the cap, so a hostile server cannot make us buffer more than
 * `maxBytes` plus one chunk.
 *
 * The messages of the errors thrown here are what the DOCX export has always
 * logged for a failed remote image; callers rely on `Fetch <status> for <url>`
 * and `Remote image > <n> bytes: <url>`.
 */

export const REMOTE_FETCH_TIMEOUT_MS = 30_000;
export const REMOTE_MAX_BYTES = 10 * 1024 * 1024; // 10MB

export interface RemoteFetchOptions {
  /** Defaults to REMOTE_FETCH_TIMEOUT_MS. The timer covers headers AND body. */
  timeoutMs?: number;
  /** Defaults to REMOTE_MAX_BYTES. */
  maxBytes?: number;
  /**
   * Reject anything that is not `https:` — the requested URL and, because
   * `fetch` follows redirects, the URL it finally landed on.
   */
  httpsOnly?: boolean;
  /** Reject a response whose content-type is not `image/*`. */
  requireImageContentType?: boolean;
  /** Injected for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

export interface RemoteFetchResult {
  bytes: Uint8Array;
  /** The response `content-type` header, "" when absent. */
  contentType: string;
}

function tooLarge(url: string, maxBytes: number): Error {
  return new Error(`Remote image > ${maxBytes} bytes: ${url}`);
}

/** Read the body, giving up as soon as it passes `maxBytes`. */
async function readCapped(
  res: Response,
  url: string,
  maxBytes: number,
  controller: AbortController,
): Promise<Uint8Array> {
  if (!res.body) {
    const arr = await res.arrayBuffer();
    if (arr.byteLength > maxBytes) throw tooLarge(url, maxBytes);
    return new Uint8Array(arr);
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      controller.abort();
      throw tooLarge(url, maxBytes);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

export async function fetchRemoteBytes(
  url: string,
  options: RemoteFetchOptions = {},
): Promise<RemoteFetchResult> {
  const maxBytes = options.maxBytes ?? REMOTE_MAX_BYTES;
  const doFetch = options.fetchImpl ?? fetch;

  if (options.httpsOnly && !/^https:\/\//i.test(url)) {
    throw new Error(`Only https: URLs are downloaded: ${url}`);
  }

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? REMOTE_FETCH_TIMEOUT_MS,
  );
  try {
    const res = await doFetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Fetch ${res.status} for ${url}`);
    if (options.httpsOnly && res.url && !/^https:\/\//i.test(res.url)) {
      throw new Error(`Redirected away from https: ${url}`);
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (options.requireImageContentType && !/^image\//i.test(contentType)) {
      throw new Error(`Not an image (${contentType || "no content-type"}): ${url}`);
    }
    const declaredSize = Number(res.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredSize) && declaredSize > maxBytes) {
      throw tooLarge(url, maxBytes);
    }
    const bytes = await readCapped(res, url, maxBytes, controller);
    return { bytes, contentType };
  } finally {
    clearTimeout(timer);
  }
}
