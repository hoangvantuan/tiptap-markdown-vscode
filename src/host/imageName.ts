/**
 * Image file name and folder from templates (#172).
 *
 * Pure: no `vscode`, no I/O, so every rule here is unit-testable. `writeImage`
 * asks this module for three things: expand `tuiMarkdown.imageSaveFolder` and
 * `tuiMarkdown.imageFileNameTemplate`, make a document name safe to put in a
 * path, and decide whether the expanded result is acceptable.
 *
 * Variables (`${name}` syntax, single pass, never re-expanded):
 *   fileName  the document's name without its extension, made path-safe
 *   name      the suggested file name without its extension, made path-safe
 *   date      local date, YYYY-MM-DD
 *   now       Date.now()
 *   random    6 base36 characters
 *   uuid      a v4 UUID
 *   ext       the extension, after magic-byte correction (#177), no dot
 *
 * Two things are deliberately NOT here:
 *   - `${workspaceDir}`. The folder guard requires the image folder to stay
 *     inside the document's folder, and a variable that points elsewhere would
 *     be the way to break it. The guard is a security boundary, not a default.
 *   - Any trust in the expanded value. A document name is user data and can
 *     hold `..`, `:` or a Windows device name, so `fileName` is sanitised on
 *     the way in AND the guards below run on what comes out. Both are needed:
 *     sanitising protects the segments a variable fills, the guards protect
 *     what the template text itself spells.
 */

export const DEFAULT_IMAGE_SAVE_FOLDER = "images";

/**
 * The suggested name's stem, unchanged, so that a user who never touches the
 * setting sees no change: a paste arrives suggested as
 * `image-<Date.now()>-<6 base36>.<ext>` (the webview still generates that) and
 * keeps it, a dropped `photo.png` is saved as `photo.png`. `.ext` is appended
 * automatically (see `expandFileName`). The one difference from before is that
 * a taken name now gets `-2`, `-3` instead of being overwritten.
 */
export const DEFAULT_IMAGE_FILENAME_TEMPLATE = "${name}";

export interface TemplateVars {
  readonly fileName: string;
  readonly name: string;
  readonly date: string;
  readonly now: string;
  readonly random: string;
  readonly uuid: string;
  readonly ext: string;
}

export type Expansion = { ok: true; value: string } | { ok: false; error: string };

// Windows reserved device names (case-insensitive), with or without an extension.
const RESERVED_NAMES = /^(CON|PRN|AUX|NUL|COM\d|LPT\d)(\.|$)/i;
// Path separators, Windows-reserved characters, control characters, and the
// right-to-left override that makes `exe.png` display as `gnp.exe`.
const UNSAFE_SEGMENT_CHARS = /[<>:"|?*\\/\x00-\x1F\u202E]/g;
const INVALID_FILENAME_CHARS = /[<>:"|?*\x00-\x1F\u202E]/;

/**
 * Make `raw` safe as ONE path segment: separators and reserved characters
 * become `_`, no `..` survives, trailing dots and spaces (which Windows drops
 * silently) go, and a device name gets a `_` prefix. Never empty.
 */
export function sanitizeNameSegment(raw: string): string {
  let s = raw.replace(UNSAFE_SEGMENT_CHARS, "_");
  s = s.replace(/\.{2,}/g, "_");
  s = s.replace(/[. ]+$/, "").trim();
  if (s === "") return "untitled";
  if (RESERVED_NAMES.test(s)) s = `_${s}`;
  return s;
}

function formatDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Six base36 characters, always six (`Math.random()` can print fewer). */
export function randomBase36(random: () => number = Math.random): string {
  return random().toString(36).substring(2, 8).padEnd(6, "0");
}

export interface VarSources {
  /** Basename of the document, with its extension. */
  readonly documentName: string;
  /** The file name the caller suggested, with its extension. */
  readonly suggestedName: string;
  /** Extension to use, already corrected against the bytes. */
  readonly ext: string;
  readonly now?: Date;
  readonly random?: () => number;
  readonly uuid?: () => string;
}

function stemOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}

export function buildTemplateVars(src: VarSources): TemplateVars {
  const now = src.now ?? new Date();
  return {
    fileName: sanitizeNameSegment(stemOf(src.documentName)),
    name: sanitizeNameSegment(stemOf(src.suggestedName)),
    date: formatDate(now),
    now: String(now.getTime()),
    random: randomBase36(src.random),
    uuid: (src.uuid ?? (() => globalThis.crypto.randomUUID()))(),
    ext: src.ext,
  };
}

/**
 * Replace every `${var}` in `template`. An unknown variable is an error rather
 * than literal text: `${filename}` written for `${fileName}` would otherwise
 * save into a folder actually named `${filename}`.
 */
export function expandTemplate(template: string, vars: TemplateVars): Expansion {
  let unknown: string | undefined;
  const value = template.replace(/\$\{([^}]*)\}/g, (_m, key: string) => {
    if (Object.prototype.hasOwnProperty.call(vars, key)) return vars[key as keyof TemplateVars];
    unknown ??= key;
    return "";
  });
  if (unknown !== undefined) return { ok: false, error: `Unknown variable \${${unknown}}` };
  return { ok: true, value };
}

/**
 * The file name for `template`. `.ext` is appended unless the template spells
 * `${ext}` itself, so `image-${now}` and `image-${now}.${ext}` mean the same.
 */
export function expandFileName(template: string, vars: TemplateVars): Expansion {
  const expanded = expandTemplate(template, vars);
  if (!expanded.ok) return expanded;
  const spellsExt = /\$\{ext\}/.test(template);
  return { ok: true, value: spellsExt ? expanded.value : `${expanded.value}.${vars.ext}` };
}

/** Strip trailing separators so `images/` and `images` give the same path. */
export function normalizeSaveFolder(folder: string): string {
  const trimmed = folder.trim().replace(/[\\/]+$/, "");
  return trimmed === "" ? "." : trimmed;
}

/**
 * Reject a file name that is not one plain, safe segment. Runs on the EXPANDED
 * name, not on the template.
 */
export function isValidImageFilename(filename: string): boolean {
  return !(
    !filename ||
    filename.includes("..") ||
    filename.includes("/") ||
    filename.includes("\\") ||
    INVALID_FILENAME_CHARS.test(filename) ||
    RESERVED_NAMES.test(filename)
  );
}

/**
 * Reject a folder that is absolute or climbs out. String inspection only; the
 * `path.relative` check against the document folder stays in `writeImage`
 * because it needs the resolved location. Runs on the EXPANDED folder.
 */
export function checkSaveFolder(folder: string): string | undefined {
  const isAbsolute = folder.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(folder);
  const hasTraversal = folder.split(/[\\/]/).includes("..");
  if (folder !== "." && (isAbsolute || hasTraversal)) {
    return "imageSaveFolder must be a relative path (or '.') within the document folder.";
  }
  return undefined;
}

/** `photo.png` -> `photo-2.png` (the collision suffix). */
export function withSuffix(filename: string, n: number): string {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0) return `${filename}-${n}`;
  return `${filename.slice(0, dot)}-${n}${filename.slice(dot)}`;
}
