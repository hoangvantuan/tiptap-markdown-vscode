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
 *
 * Since #172 the folder and the file name come from templates
 * (`imageSaveFolder`, `imageFileNameTemplate`; see `imageName.ts`), so every
 * one of those guards runs on the EXPANDED value: the point of a guard is the
 * path that reaches disk, not the setting that produced it. Since #177 the
 * extension comes from the bytes (`imageFormat.ts`) rather than from the hint.
 */
import * as path from "path";
import * as vscode from "vscode";
import type { SaveImageMessage } from "../shared/messages";
import { getImageFileNameTemplate, getImageSaveFolder } from "./config";
import { correctExtension } from "./imageFormat";
import {
  buildTemplateVars,
  checkSaveFolder,
  expandFileName,
  expandTemplate,
  isValidImageFilename,
  normalizeSaveFolder,
  withSuffix,
} from "./imageName";
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

/** Two images saved at once must not both pick the same free name. */
let writeQueue: Promise<unknown> = Promise.resolve();

/**
 * Validate, place and write image bytes for `document`; the one path every
 * image source (paste, drop, and any later one) goes through, so the guards in
 * the header apply to all of them. Returns `undefined` after showing the
 * error when a guard rejects or the write fails.
 *
 * `filename` is a SUGGESTION, not the name the file gets. It is the source of
 * the extension (corrected when the bytes say it is wrong, #177) and of the
 * `${name}` template variable. The real name comes from
 * `tuiMarkdown.imageFileNameTemplate`, in the folder `tuiMarkdown.imageSaveFolder`
 * expands to, and a name already taken gets a `-2`, `-3`... suffix instead of
 * being overwritten. Callers must therefore use the returned `relativePath` and
 * `fileUri`, never rebuild them from `filename`.
 */
export function writeImage(
  document: vscode.TextDocument,
  filename: string,
  bytes: Uint8Array,
): Promise<{ fileUri: vscode.Uri; relativePath: string } | undefined> {
  const run = writeQueue.then(() => writeImageNow(document, filename, bytes));
  writeQueue = run.catch(() => undefined);
  return run;
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

async function writeImageNow(
  document: vscode.TextDocument,
  filename: string,
  bytes: Uint8Array,
): Promise<{ fileUri: vscode.Uri; relativePath: string } | undefined> {
  // The suggestion is held to the same standard as the final name: it feeds
  // `${name}` and the extension, and a hostile one has no business there.
  if (!isValidImageFilename(filename)) {
    console.error("[Image Save] Invalid filename:", filename);
    vscode.window.showErrorMessage("Invalid filename");
    return undefined;
  }

  try {
    const dot = filename.lastIndexOf(".");
    const hintExt = dot > 0 ? filename.slice(dot + 1) : "";
    const ext = correctExtension(/^[A-Za-z0-9]{1,16}$/.test(hintExt) ? hintExt : "", bytes);
    const vars = buildTemplateVars({
      documentName: path.basename(document.uri.fsPath),
      suggestedName: filename,
      ext,
    });

    // Expand the folder, then guard the RESULT.
    const folderExpansion = expandTemplate(getImageSaveFolder(), vars);
    if (!folderExpansion.ok) {
      vscode.window.showErrorMessage(`imageSaveFolder: ${folderExpansion.error}`);
      return undefined;
    }
    const saveFolder = normalizeSaveFolder(folderExpansion.value);
    const folderError = checkSaveFolder(saveFolder);
    if (folderError) {
      vscode.window.showErrorMessage(folderError);
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

    // Expand the file name, then guard the RESULT.
    const nameExpansion = expandFileName(getImageFileNameTemplate(), vars);
    if (!nameExpansion.ok) {
      vscode.window.showErrorMessage(`imageFileNameTemplate: ${nameExpansion.error}`);
      return undefined;
    }
    if (!isValidImageFilename(nameExpansion.value)) {
      console.error("[Image Save] Invalid filename:", nameExpansion.value);
      vscode.window.showErrorMessage("Invalid filename");
      return undefined;
    }

    // Create folder if not exists
    try {
      await vscode.workspace.fs.createDirectory(imageFolder);
    } catch {
      // Folder may already exist
    }

    let finalName = nameExpansion.value;
    for (let n = 2; n < 10000 && (await exists(vscode.Uri.joinPath(imageFolder, finalName))); n++) {
      finalName = withSuffix(nameExpansion.value, n);
    }

    const fileUri = vscode.Uri.joinPath(imageFolder, finalName);
    await vscode.workspace.fs.writeFile(fileUri, bytes);

    // Build relative path for markdown
    const relativePath =
      saveFolder === "." ? finalName : `${saveFolder}/${finalName}`;
    return { fileUri, relativePath };
  } catch (err) {
    console.error("[Image Save] Failed:", err);
    vscode.window.showErrorMessage(
      `Failed to save image: ${err instanceof Error ? err.message : String(err)}`,
    );
    return undefined;
  }
}
