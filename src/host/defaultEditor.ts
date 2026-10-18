/**
 * `defaultEditor`: configure the default editor for markdown in this workspace.
 *
 * Background and intent:
 * In package.json, `contributes.customEditors` registers `tuiMarkdown.editor` with
 * priority "default". Consequently, `.md` files already open in Tiptap Markdown by
 * default in all workspaces without any explicit workspace configuration.
 *
 * The real need reported by users in #48 is the opposite direction: opting OUT
 * of Tiptap Markdown for a specific workspace so markdown files open in VS Code's
 * built-in text editor instead (preventing interception of git diffs and allowing
 * raw editing).
 *
 * To serve both directions safely and avoid one-way traps, this command presents
 * a QuickPick with three explicit outcomes:
 * 1. "Tiptap Markdown (WYSIWYG)": writes "*.md": "tuiMarkdown.editor" to workspace.
 * 2. "Text editor (raw markdown)": writes "*.md": "default" to workspace.
 * 3. "Reset to the extension default": clears workspace associations for markdown.
 *
 * The setting is written to `workbench.editorAssociations` under
 * ConfigurationTarget.Workspace.
 *
 * Keys, and why they carry a scheme (#169): VS Code matches an
 * `editorAssociations` key with the SAME `globMatchesResource` it matches a
 * `contributes.customEditors` selector with, and its rule is that a pattern
 * WITHOUT a `/` is matched against the basename
 * (`editorResolverService.ts`, 1.85):
 *
 *     const matchOnPath = typeof globPattern === 'string' && globPattern.indexOf(posix.sep) >= 0;
 *     const target = matchOnPath ? `${resource.scheme}:${resource.path}` : basename(resource);
 *
 * A bare `*.md` is therefore an association on EVERY scheme, and VS Code
 * resolves a registered custom editor that a setting points at even when its
 * selector does not match the resource ("The user setting should be respected
 * even if the editor doesn't specify that resource in package.json"). So the
 * bare `*.md` this command used to write re-opened, for any workspace that ran
 * it, every hole the scheme allowlist in package.json exists to close: a git
 * diff, a PR review, another extension's virtual markdown document. The keys
 * written here name the same four schemes as the selector.
 *
 * What it may remove: an association whose value is one this command writes
 * (`tuiMarkdown.editor` or `default`) is this command's own key, and the
 * command deletes its own keys. Any other value on any key, and any key it does
 * not recognise, belongs to the user and is left alone — including in the reset
 * mode, which is scoped to what this command wrote.
 */
import * as vscode from "vscode";

export type EditorMode = "wysiwyg" | "text" | "reset";

export interface EditorModeOption {
  label: string;
  description?: string;
  detail: string;
  mode: EditorMode;
}

/** The values this command writes. A key carrying one of them is its own. */
const OWNED_VALUES = new Set(["tuiMarkdown.editor", "default"]);

/**
 * The keys this command writes: the four schemes `contributes.customEditors`
 * selects, for both markdown extensions. `**` and not `*` after the scheme,
 * because `*` does not cross a path separator and an untitled document that
 * carries an associated path is a real path like `/home/u/notes/readme.md`.
 */
const OWNED_KEYS: string[] = [
  "file:/**/*.md",
  "vscode-remote:/**/*.md",
  "vscode-vfs:/**/*.md",
  "untitled:/**/*.md",
  "file:/**/*.markdown",
  "vscode-remote:/**/*.markdown",
  "vscode-vfs:/**/*.markdown",
  "untitled:/**/*.markdown",
];

/** The pre-#169 spelling of the same keys, kept so they can be cleaned up. */
const LEGACY_KEYS: string[] = ["*.md", "*.markdown"];

const ALL_OWNED_KEYS = new Set([...OWNED_KEYS, ...LEGACY_KEYS]);

/** An association this command may delete: a key of ours carrying our value. */
function isOwnedAssociation(key: string, value: string | undefined): boolean {
  return ALL_OWNED_KEYS.has(key) && OWNED_VALUES.has(value ?? "");
}

/**
 * Drop every association this command owns, in BOTH spellings, and report what
 * was left. Everything else in `current` is carried through untouched.
 */
function withoutOwnAssociations(
  current: Record<string, string>,
): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [key, value] of Object.entries(current)) {
    if (!isOwnedAssociation(key, value)) {
      kept[key] = value;
    }
  }
  return kept;
}

/** Does any key of ours — scheme-qualified or legacy — carry `value`? */
function hasOwnedAssociation(assoc: Record<string, string>, value: string): boolean {
  return Object.entries(assoc).some(
    ([key, entry]) => ALL_OWNED_KEYS.has(key) && entry === value,
  );
}

/**
 * Compute the updated editorAssociations dictionary for the given mode.
 * Returns undefined when resetting and no other associations remain,
 * which instructs VS Code to remove the key from settings.json.
 */
export function computeUpdatedAssociations(
  current: Record<string, string> = {},
  mode: EditorMode,
): Record<string, string> | undefined {
  // Whatever the mode, the previous spellings go first: leaving a bare `*.md`
  // behind while writing the scheme-qualified keys would re-open exactly the
  // hole this command exists to keep shut.
  const kept = withoutOwnAssociations(current);

  if (mode === "wysiwyg" || mode === "text") {
    const value = mode === "wysiwyg" ? "tuiMarkdown.editor" : "default";
    return { ...kept, ...Object.fromEntries(OWNED_KEYS.map((k) => [k, value])) };
  }

  if (mode === "reset") {
    return Object.keys(kept).length > 0 ? kept : undefined;
  }
  return undefined;
}

/**
 * Detect the current markdown editor mode configured for this workspace.
 * Reads both spellings, so a workspace configured before #169 is recognised.
 */
export function getCurrentWorkspaceMode(
  assoc?: Record<string, string>,
): "wysiwyg" | "text" | "default" {
  if (!assoc) return "default";
  if (hasOwnedAssociation(assoc, "tuiMarkdown.editor")) return "wysiwyg";
  if (hasOwnedAssociation(assoc, "default")) return "text";
  return "default";
}

/**
 * Build QuickPick options reflecting the current workspace configuration.
 */
export function buildQuickPickOptions(
  currentMode: "wysiwyg" | "text" | "default",
): EditorModeOption[] {
  return [
    {
      label: "Tiptap Markdown (WYSIWYG)",
      description: currentMode === "wysiwyg" ? "(current)" : undefined,
      detail: "Always open markdown files with Tiptap Markdown in this workspace",
      mode: "wysiwyg",
    },
    {
      label: "Text editor (raw markdown)",
      description: currentMode === "text" ? "(current)" : undefined,
      detail: "Always open markdown files with the built-in text editor in this workspace",
      mode: "text",
    },
    {
      label: "Reset to the extension default",
      description: currentMode === "default" ? "(current)" : undefined,
      detail:
        "Remove the markdown associations this extension wrote and inherit default behavior",
      mode: "reset",
    },
  ];
}

/**
 * Execute the command: prompt via QuickPick and apply the chosen association.
 */
export async function useAsDefaultEditor(): Promise<EditorMode | undefined> {
  if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
    vscode.window.showWarningMessage("No workspace folder is open.");
    return undefined;
  }

  const config = vscode.workspace.getConfiguration("workbench");
  const inspect = config.inspect<Record<string, string>>("editorAssociations");
  const currentAssoc = { ...(inspect?.workspaceValue || {}) };

  const currentMode = getCurrentWorkspaceMode(currentAssoc);
  const options = buildQuickPickOptions(currentMode);

  const chosen = await vscode.window.showQuickPick(options, {
    placeHolder: "Select default editor for Markdown in this workspace",
  });

  if (!chosen) return undefined;

  const nextAssoc = computeUpdatedAssociations(currentAssoc, chosen.mode);
  await config.update(
    "editorAssociations",
    nextAssoc,
    vscode.ConfigurationTarget.Workspace,
  );

  return chosen.mode;
}
