/**
 * Image format detection from magic bytes (#177), and the extension a saved
 * image should carry because of it.
 *
 * Pure: no `vscode`, no I/O. The extension a pasted or dropped image arrives
 * with comes from the MIME type or file name the webview was handed, and both
 * can lie (a WebP the clipboard labels `image/png`). The bytes cannot, so
 * `writeImage` asks this module what the file really is.
 *
 * The table is hand-written and covers exactly what the editor displays
 * natively: PNG, JPEG, GIF, WebP and SVG. Anything else (BMP, AVIF, ICO...)
 * is "not recognised", and the caller keeps the extension it was given. That
 * is deliberate: an unrecognised signature is not evidence the hint is wrong.
 *
 * SVG is text, so it is recognised by what follows an optional UTF-8 BOM and
 * whitespace: `<svg`, or an `<?xml` prolog. A `<?xml` prolog is not checked
 * for an `<svg` root, so a non-SVG XML file labelled `image/*` would be
 * renamed `.svg`; the webview only forwards `image/*` blobs, and the cost of
 * that false positive is a wrong extension on a file that was never an image.
 */

export interface ImageFormat {
  /** Canonical extension, no dot, lower case. */
  readonly ext: string;
  /** Every extension that is a correct name for these bytes (includes `ext`). */
  readonly aliases: readonly string[];
}

const PNG: ImageFormat = { ext: "png", aliases: ["png"] };
const JPEG: ImageFormat = { ext: "jpg", aliases: ["jpg", "jpeg"] };
const GIF: ImageFormat = { ext: "gif", aliases: ["gif"] };
const WEBP: ImageFormat = { ext: "webp", aliases: ["webp"] };
const SVG: ImageFormat = { ext: "svg", aliases: ["svg"] };

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((b, i) => bytes[offset + i] === b);
}

function ascii(s: string): number[] {
  return Array.from(s, (c) => c.charCodeAt(0));
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIG = [0xff, 0xd8, 0xff];
const GIF87 = ascii("GIF87a");
const GIF89 = ascii("GIF89a");
const RIFF = ascii("RIFF");
const WEBP_TAG = ascii("WEBP");
const SVG_TAG = ascii("<svg");
const XML_TAG = ascii("<?xml");

/** Bytes to look past before giving up on finding the first `<`. */
const SVG_SCAN_LIMIT = 1024;

function looksLikeSvg(bytes: Uint8Array): boolean {
  let i = 0;
  if (startsWith(bytes, [0xef, 0xbb, 0xbf])) i = 3;
  const limit = Math.min(bytes.length, i + SVG_SCAN_LIMIT);
  // Space, tab, LF, CR: the whitespace an XML prolog may be preceded by.
  while (i < limit && (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0a || bytes[i] === 0x0d)) {
    i++;
  }
  return startsWith(bytes, SVG_TAG, i) || startsWith(bytes, XML_TAG, i);
}

/** The format `bytes` really are, or `undefined` when the table does not know. */
export function detectImageFormat(bytes: Uint8Array): ImageFormat | undefined {
  if (startsWith(bytes, PNG_SIG)) return PNG;
  if (startsWith(bytes, JPEG_SIG)) return JPEG;
  if (startsWith(bytes, GIF87) || startsWith(bytes, GIF89)) return GIF;
  // WebP is a RIFF container: "RIFF", a 4-byte size, then "WEBP".
  if (startsWith(bytes, RIFF) && startsWith(bytes, WEBP_TAG, 8)) return WEBP;
  if (looksLikeSvg(bytes)) return SVG;
  return undefined;
}

/**
 * The extension to save `bytes` under, given the one the caller suggested
 * (no dot; may be empty).
 *
 * A suggestion that is a correct name for the detected format is returned
 * untouched, case included (`.jpeg` stays `.jpeg` for a JPEG). One that is not
 * is replaced by the canonical extension. When the bytes are not recognised the
 * suggestion stands; with no suggestion either, `png`, which is what the
 * webview falls back to when a MIME type has no subtype.
 */
export function correctExtension(suggestedExt: string, bytes: Uint8Array): string {
  const detected = detectImageFormat(bytes);
  if (!detected) return suggestedExt || "png";
  if (detected.aliases.includes(suggestedExt.toLowerCase())) return suggestedExt;
  return detected.ext;
}
