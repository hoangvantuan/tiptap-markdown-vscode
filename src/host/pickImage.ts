/**
 * `pickImage` (#173): insert an image chosen in a file dialog.
 *
 * Everything happens on the host, in the workspace's own filesystem:
 * `showOpenDialog` is the workspace's dialog and `workspace.fs` its files, so
 * under Remote SSH / WSL the picker browses the REMOTE machine and the bytes
 * are read where the document lives. That is the point of the entry: native
 * clipboard paste (readClipboardImage.ts) reads the clipboard of the machine
 * the host runs on, which under a remote window is not the one the user is
 * sitting at. The file's bytes never travel through the webview, so there is no
 * base64 round trip: the webview learns only the saved relative path and the
 * URI to display.
 *
 * The write goes through `writeImage` (saveImage.ts), the one path every image
 * source shares, so the filename and folder guards apply here too.
 *
 * Every outcome answers the request. A cancelled dialog, an unreadable file and
 * a rejected write all reply `imagePicked` WITHOUT `savedPath`: the webview is
 * holding a document position for `requestId` and must be told to let go.
 */
import * as vscode from "vscode";
import type { PickImageMessage } from "../shared/messages";
import type { TypedWebview } from "./typedWebview";
import { writeImage } from "./saveImage";

/** What the dialog filters to, and what a picked file must end with. */
export const IMAGE_FILE_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "bmp",
  "avif",
];

/** The same ceiling a pasted image has (main.ts MAX_IMAGE_SIZE). */
export const PICKED_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

export interface PickImageDeps {
  showOpenDialog: (
    options: vscode.OpenDialogOptions,
  ) => Thenable<vscode.Uri[] | undefined>;
  stat: (uri: vscode.Uri) => Thenable<{ size: number }>;
  readFile: (uri: vscode.Uri) => Thenable<Uint8Array>;
  writeImage: typeof writeImage;
  showWarningMessage: (message: string) => void;
}

const defaultDeps: PickImageDeps = {
  showOpenDialog: (o) => vscode.window.showOpenDialog(o),
  stat: (u) => vscode.workspace.fs.stat(u),
  readFile: (u) => vscode.workspace.fs.readFile(u),
  writeImage,
  showWarningMessage: (m) => {
    void vscode.window.showWarningMessage(m);
  },
};

/** Last path segment of a URI path (posix, whatever the remote OS is). */
function baseName(uriPath: string): string {
  const i = uriPath.lastIndexOf("/");
  return i === -1 ? uriPath : uriPath.slice(i + 1);
}

// Windows reserved device names (case-insensitive).
const RESERVED_NAMES = /^(CON|PRN|AUX|NUL|COM\d|LPT\d)(\.|$)/i;

/**
 * Split a picked file name into a markdown-safe alt text and the suggested
 * filename to hand to `writeImage`.
 *
 * `writeImage` rejects, rather than repairs, characters Windows forbids on its
 * input filename, so a picked name like `a:b.png` is sanitised here first. The
 * stem itself is kept clean (no random suffix): `writeImage` expands
 * `tuiMarkdown.imageFileNameTemplate` (default `${name}`), corrects the
 * extension from the file's magic bytes, and appends `-2`, `-3`... on
 * collision, so the caller must use the `relativePath` `writeImage` returns.
 */
export function pickedImageNames(
  originalName: string,
): { alt: string; filename: string } | undefined {
  const dot = originalName.lastIndexOf(".");
  const ext = dot > 0 ? originalName.slice(dot + 1).toLowerCase() : "";
  if (!IMAGE_FILE_EXTENSIONS.includes(ext)) return undefined;
  const rawStem = originalName.slice(0, dot);
  const stem = rawStem
    .replace(/[<>:"|?*\\/\x00-\x1F\u202E]/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/[. ]+$/, "")
    .trim()
    .slice(0, 80);
  let safeStem = stem && stem !== "." ? stem : "image";
  if (RESERVED_NAMES.test(safeStem)) safeStem = `_${safeStem}`;
  return { alt: safeStem, filename: `${safeStem}.${ext}` };
}

export async function handlePickImage(
  msg: PickImageMessage,
  document: vscode.TextDocument,
  webview: TypedWebview,
  deps: PickImageDeps = defaultDeps,
): Promise<void> {
  const requestId = msg.requestId;
  const reply = (picked: {
    savedPath?: string;
    webviewUri?: string;
    alt?: string;
  }) => {
    try {
      void webview.postMessage({ type: "imagePicked", requestId, ...picked });
    } catch {
      /* webview disposed while the dialog was open */
    }
  };

  try {
    const uris = await deps.showOpenDialog({
      canSelectMany: false,
      canSelectFiles: true,
      canSelectFolders: false,
      openLabel: "Insert Image",
      title: "Insert image from file",
      defaultUri: vscode.Uri.joinPath(document.uri, ".."),
      filters: { Images: IMAGE_FILE_EXTENSIONS },
    });
    const picked = uris?.[0];
    if (!picked) {
      reply({});
      return;
    }

    const names = pickedImageNames(baseName(picked.path));
    if (!names) {
      deps.showWarningMessage(
        `Not a supported image file: ${baseName(picked.path)}`,
      );
      reply({});
      return;
    }

    const { size } = await deps.stat(picked);
    if (size > PICKED_IMAGE_MAX_BYTES) {
      deps.showWarningMessage(
        `Image too large (${(size / 1024 / 1024).toFixed(1)}MB). Maximum is ${PICKED_IMAGE_MAX_BYTES / 1024 / 1024}MB.`,
      );
      reply({});
      return;
    }

    const bytes = await deps.readFile(picked);
    const saved = await deps.writeImage(document, names.filename, bytes);
    if (!saved) {
      // writeImage has already told the user why.
      reply({});
      return;
    }

    reply({
      savedPath: saved.relativePath,
      webviewUri: webview.asWebviewUri(saved.fileUri).toString(),
      alt: names.alt,
    });
  } catch (err) {
    console.error("[Image Pick] Failed:", err);
    deps.showWarningMessage(
      `Failed to insert image: ${err instanceof Error ? err.message : String(err)}`,
    );
    reply({});
  }
}
