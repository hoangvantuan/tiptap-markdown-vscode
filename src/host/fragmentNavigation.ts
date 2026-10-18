/**
 * Following a link to another document's `#heading` (#171).
 *
 * `[[Note#Heading]]` and `[text](other.md#heading)` open the target and scroll
 * it to the heading. The fragment has to cross from the link's panel to the
 * target's, and the target is in one of three states when the link is
 * followed:
 *
 * 1. NOT OPEN in this custom editor (`panelsByDoc` has no panel for the target):
 *    the fragment waits in `pendingByDoc` under the target's key and the
 *    target's own `ready` takes it (`takePendingFragment`, called from the
 *    `ready` handler). Only the newest link per document waits; following
 *    another link to the same document replaces it.
 * 2. ALREADY OPEN in this custom editor (`panelsByDoc` already holds a panel
 *    for the target): `vscode.open` reveals the existing panel whose webview is
 *    already live and will not re-send `ready`, so `scrollTo` is posted
 *    directly to that panel and nothing waits in `pendingByDoc`.
 * 3. OPEN AS TEXT: the user's default editor for the file is the standard text
 *    editor, so after `vscode.open` resolves `vscode.window.activeTextEditor`
 *    holds the target document. The pending fragment is cleared and the text
 *    editor is moved to the heading with `revealRange`.
 *
 * Scrolling happens ONLY when a link carries an explicit fragment. Nothing here
 * remembers or restores any other position; that was #121, and it was
 * withdrawn.
 */
import * as vscode from "vscode";
import type { TypedWebview } from "./typedWebview";
import { fragmentMatchesHeading } from "../webview/heading-slug";

/** The part of a webview panel this module reads, so tests can supply one. */
export interface ScrollTargetPanel {
  readonly active: boolean;
  readonly visible: boolean;
}

interface ScrollTarget {
  panel: ScrollTargetPanel;
  webview: Pick<TypedWebview, "postMessage">;
}

const panelsByDoc = new Map<string, Set<ScrollTarget>>();
const pendingByDoc = new Map<string, string>();

/**
 * The key both sides agree on for one document. `document.uri` as VS Code
 * hands it to the provider and the `Uri.file()` built from a link need not
 * spell a path identically where the filesystem ignores case, so the key folds
 * case there.
 */
export function fragmentDocKey(uri: vscode.Uri): string {
  const p = uri.fsPath;
  return process.platform === "win32" || process.platform === "darwin" ? p.toLowerCase() : p;
}

/** Whether a link target is a document this editor opens, and so can scroll. */
export function isMarkdownPath(filePath: string): boolean {
  return /\.(md|markdown)$/i.test(filePath);
}

/**
 * Register a panel showing `uri` as a place a fragment can be delivered.
 * Called from `resolveCustomTextEditor`; dispose with the panel.
 */
export function registerScrollTarget(
  uri: vscode.Uri,
  panel: ScrollTargetPanel,
  webview: Pick<TypedWebview, "postMessage">,
): { dispose(): void } {
  const key = fragmentDocKey(uri);
  const target: ScrollTarget = { panel, webview };
  let set = panelsByDoc.get(key);
  if (!set) {
    set = new Set();
    panelsByDoc.set(key, set);
  }
  set.add(target);
  return {
    dispose() {
      const current = panelsByDoc.get(key);
      if (!current) return;
      current.delete(target);
      if (current.size === 0) panelsByDoc.delete(key);
    },
  };
}

/** Take (and forget) the fragment waiting for `uri`, if a link left one. */
export function takePendingFragment(uri: vscode.Uri): string | undefined {
  const key = fragmentDocKey(uri);
  const fragment = pendingByDoc.get(key);
  pendingByDoc.delete(key);
  return fragment;
}

/** Test seam: forget every panel and every waiting fragment. */
export function resetFragmentNavigation(): void {
  panelsByDoc.clear();
  pendingByDoc.clear();
}

/**
 * The 0-based line of the first heading in markdown `text` that `fragment`
 * names, or -1. For the text-editor case only; the custom editor matches on
 * its parsed document instead. ATX (`## Title`) and setext (`Title` over `===`
 * or `---`) headings outside fenced code blocks.
 */
export function findHeadingLine(text: string, fragment: string): number {
  const lines = text.split(/\r?\n/);
  let fence: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      if (fence === null) fence = fenceMatch[1];
      else if (fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const atx = /^ {0,3}#{1,6}(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/.exec(line);
    if (atx) {
      if (fragmentMatchesHeading(fragment, atx[1] ?? "")) return i;
      continue;
    }
    const next = lines[i + 1];
    if (next !== undefined && line.trim() !== "" && /^ {0,3}(=+|-+)[ \t]*$/.test(next)) {
      if (fragmentMatchesHeading(fragment, line.trim())) return i;
    }
  }
  return -1;
}

function revealInActiveTextEditor(uri: vscode.Uri, fragment: string): boolean {
  const editor = vscode.window.activeTextEditor;
  if (!editor || fragmentDocKey(editor.document.uri) !== fragmentDocKey(uri)) return false;
  const line = findHeadingLine(editor.document.getText(), fragment);
  if (line >= 0) {
    const position = new vscode.Position(line, 0);
    const range = new vscode.Range(position, position);
    if (typeof vscode.Selection === "function") {
      editor.selection = new vscode.Selection(position, position);
    }
    const atTop = vscode.TextEditorRevealType?.AtTop ?? 3;
    editor.revealRange(range, atTop);
  }
  return true;
}

/**
 * Open `uri` and, when `fragment` is non-null, scroll it to the heading the
 * fragment names. `open` is `vscode.open` in the extension; tests can pass
 * their own callback.
 */
export async function openWithFragment(
  uri: vscode.Uri,
  fragment: string | null,
  open: (target: vscode.Uri) => Thenable<unknown> = (target) =>
    vscode.commands.executeCommand("vscode.open", target),
): Promise<void> {
  if (!fragment) {
    await open(uri);
    return;
  }
  const key = fragmentDocKey(uri);
  const existing = [...(panelsByDoc.get(key) ?? [])];
  if (existing.length > 0) {
    // Case 2: already open in the custom editor. `open` reveals the panel; post
    // `scrollTo` directly to it since an already-mounted webview does not
    // re-send `ready`.
    await open(uri);
    const current = [...(panelsByDoc.get(key) ?? existing)];
    const target =
      current.find((t) => t.panel.active) ??
      current.find((t) => t.panel.visible) ??
      current[0];
    target?.webview.postMessage({ type: "scrollTo", fragment });
    return;
  }

  // Case 1: not open yet in the custom editor. Hold the fragment in
  // `pendingByDoc` until the target webview's `ready` handler takes it.
  pendingByDoc.set(key, fragment);
  try {
    await open(uri);
  } catch (err) {
    if (pendingByDoc.get(key) === fragment) pendingByDoc.delete(key);
    throw err;
  }
  // Case 3: if `open` opened the document in the standard text editor instead
  // of our custom editor, reveal the heading there and clear the pending entry.
  if (pendingByDoc.get(key) === fragment && revealInActiveTextEditor(uri, fragment)) {
    pendingByDoc.delete(key);
  }
}
