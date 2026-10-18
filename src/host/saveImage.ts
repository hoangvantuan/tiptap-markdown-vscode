/**
 * `saveImage`: write a pasted/dropped image next to the document and hand the
 * webview back both the markdown-relative path and a webview URI.
 *
 * Three independent guards run before anything touches disk, because the
 * filename and the folder both arrive from the webview: the filename is
 * rejected outright on separators, traversal, control characters and Windows
 * reserved device names; `imageSaveFolder` is rejected when absolute or
 * containing `..`; and the joined folder is re-checked with `path.relative`
 * against the document folder, which catches what string inspection misses
 * (symlinks aside). Each rejection returns without writing.
 */
import * as path from "path";
import * as vscode from "vscode";
import type { SaveImageMessage } from "../shared/messages";
import type { TypedWebview } from "./typedWebview";

export async function handleSaveImage(
  msg: SaveImageMessage,
  document: vscode.TextDocument,
  webview: TypedWebview,
): Promise<void> {
  const imgMsg = msg;
  if (!imgMsg.data || !imgMsg.filename || !imgMsg.blobUrl) return;

  // Decode base64
  // Note: Use [^;]+ to match MIME types like image/svg+xml
  const base64Data = imgMsg.data.replace(
    /^data:image\/[^;]+;base64,/i,
    "",
  );
  const saved = await writeImage(document, imgMsg.filename, Buffer.from(base64Data, "base64"));
  if (!saved) return;

  // Send back the saved path and a webview URI for immediate display
  webview.postMessage({
    type: "imageSaved",
    blobUrl: imgMsg.blobUrl,
    savedPath: saved.relativePath,
    webviewUri: webview.asWebviewUri(saved.fileUri).toString(),
  });
}

/**
 * Validate, place and write image bytes for `document`; the one path every
 * image source (paste, drop, and any later one) goes through, so the guards in
 * the header apply to all of them. Returns `undefined` after showing the
 * error when a guard rejects or the write fails.
 */
export async function writeImage(
  document: vscode.TextDocument,
  filename: string,
  bytes: Uint8Array,
): Promise<{ fileUri: vscode.Uri; relativePath: string } | undefined> {
  // Security: Strong filename validation
  // Block: path traversal, separators, null bytes, control chars, Windows reserved chars
  const INVALID_FILENAME_CHARS = /[<>:"|?*\x00-\x1F\u202E]/;
  // Windows reserved device names (case-insensitive)
  const RESERVED_NAMES = /^(CON|PRN|AUX|NUL|COM\d|LPT\d)(\.|$)/i;

  if (
    !filename ||
    filename.includes("..") ||
    filename.includes("/") ||
    filename.includes("\\") ||
    INVALID_FILENAME_CHARS.test(filename) ||
    RESERVED_NAMES.test(filename)
  ) {
    console.error("[Image Save] Invalid filename:", filename);
    vscode.window.showErrorMessage("Invalid filename");
    return undefined;
  }

  try {
    // Get configured folder
    const config = vscode.workspace.getConfiguration("tuiMarkdown");
    let saveFolder = config.get<string>("imageSaveFolder", "images")?.trim() || "images";

    // Security: Validate saveFolder to prevent path traversal
    const isAbsolute = saveFolder.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(saveFolder);
    const hasTraversal = saveFolder.split(/[\\/]/).includes("..");
    if (saveFolder !== "." && (isAbsolute || hasTraversal)) {
      vscode.window.showErrorMessage(
        "imageSaveFolder must be a relative path (or '.') within the document folder."
      );
      return undefined;
    }

    // Resolve folder path relative to document
    const documentFolder = vscode.Uri.joinPath(document.uri, "..");
    const imageFolder = vscode.Uri.joinPath(documentFolder, saveFolder);

    // Security: Verify resolved path is within document directory
    const rel = path.relative(documentFolder.fsPath, imageFolder.fsPath);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      vscode.window.showErrorMessage(
        "imageSaveFolder resolves outside document folder."
      );
      return undefined;
    }

    // Create folder if not exists
    try {
      await vscode.workspace.fs.createDirectory(imageFolder);
    } catch {
      // Folder may already exist
    }

    const fileUri = vscode.Uri.joinPath(imageFolder, filename);
    await vscode.workspace.fs.writeFile(fileUri, bytes);

    // Build relative path for markdown
    const relativePath =
      saveFolder === "." ? filename : `${saveFolder}/${filename}`;
    return { fileUri, relativePath };
  } catch (err) {
    console.error("[Image Save] Failed:", err);
    vscode.window.showErrorMessage(
      `Failed to save image: ${err instanceof Error ? err.message : String(err)}`,
    );
    return undefined;
  }
}
