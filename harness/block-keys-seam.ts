/**
 * Block keys seam for the dependency-verification harness (#178).
 *
 * Exercises src/webview/block-keys-extension.ts: Alt-ArrowUp / Alt-ArrowDown
 * move a block (or a list item), Mod-Enter / Mod-Shift-Enter insert an empty
 * paragraph after / before the top-level block. Each case is markdown in, a
 * cursor position, a key, markdown out. The key goes through the editor's own
 * handleKeyDown props, in plugin order, exactly as a browser keydown would.
 *
 * The seam records what happened (handled, the markdown, where the caret ended)
 * and asserts nothing about it; the golden file is the expectation. Cases that
 * stay the same without the extension are upstream behaviour and say so:
 *   - Mod-Enter in a code block is core's exitCode, which the extension leaves alone.
 *   - Shift-Enter is HardBreak's, which the extension leaves alone.
 *
 * Not covered here, because jsdom has no workbench: whether VS Code delivers
 * Alt-ArrowUp / Alt-ArrowDown to the webview at all.
 */
import { createHarnessEditor } from "./editor";
import { transformTableCellsAfterParse } from "../src/webview/table-cell-content-parser";
import type { Editor } from "@tiptap/core";

interface KeySpec {
  label: string;
  key: string;
  alt?: boolean;
  shift?: boolean;
  /** Mod: Ctrl in jsdom (navigator.platform is not a Mac). */
  mod?: boolean;
}

const ALT_UP: KeySpec = { label: "Alt+ArrowUp", key: "ArrowUp", alt: true };
const ALT_DOWN: KeySpec = { label: "Alt+ArrowDown", key: "ArrowDown", alt: true };
const MOD_ENTER: KeySpec = { label: "Mod+Enter", key: "Enter", mod: true };
const MOD_SHIFT_ENTER: KeySpec = { label: "Mod+Shift+Enter", key: "Enter", mod: true, shift: true };
const SHIFT_ENTER: KeySpec = { label: "Shift+Enter", key: "Enter", shift: true };

interface Case {
  name: string;
  markdown: string;
  /** Cursor goes to the start of the first occurrence of this text. */
  at: string;
  key: KeySpec;
}

const CASES: Case[] = [
  // Top-level blocks
  { name: "paragraph-down-mid-document", markdown: "one\n\ntwo\n\nthree", at: "two", key: ALT_DOWN },
  { name: "paragraph-up-mid-document", markdown: "one\n\ntwo\n\nthree", at: "two", key: ALT_UP },
  { name: "first-block-up-is-noop", markdown: "one\n\ntwo\n\nthree", at: "one", key: ALT_UP },
  { name: "last-block-down-is-noop", markdown: "one\n\ntwo\n\nthree", at: "three", key: ALT_DOWN },
  { name: "single-block-document-up", markdown: "only", at: "only", key: ALT_UP },
  { name: "heading-down", markdown: "# Title\n\nbody\n\nlast", at: "Title", key: ALT_DOWN },
  { name: "code-block-up", markdown: "intro\n\n```js\nconst a = 1;\n```\n\nafter", at: "const", key: ALT_UP },
  { name: "blockquote-down", markdown: "> quoted\n\nplain", at: "quoted", key: ALT_DOWN },

  // Lists: the item moves, and never leaves its list
  { name: "list-item-down", markdown: "- a\n- b\n- c", at: "a", key: ALT_DOWN },
  { name: "list-item-up", markdown: "- a\n- b\n- c", at: "c", key: ALT_UP },
  { name: "list-first-item-up-is-noop", markdown: "intro\n\n- a\n- b", at: "a", key: ALT_UP },
  { name: "list-last-item-down-is-noop", markdown: "- a\n- b\n\noutro", at: "b", key: ALT_DOWN },
  { name: "ordered-item-down-renumbers", markdown: "1. a\n2. b\n3. c", at: "a", key: ALT_DOWN },
  { name: "nested-item-down", markdown: "- top\n  - x\n  - y\n- other", at: "x", key: ALT_DOWN },
  { name: "nested-last-item-down-is-noop", markdown: "- top\n  - x\n  - y\n- other", at: "y", key: ALT_DOWN },
  { name: "task-item-up", markdown: "- [ ] one\n- [x] two", at: "two", key: ALT_UP },

  // Tables: the whole table moves; a row never does
  { name: "table-cell-down-moves-table", markdown: "| h1 | h2 |\n| --- | --- |\n| c1 | c2 |\n\nafter", at: "c1", key: ALT_DOWN },
  { name: "table-cell-up-moves-table", markdown: "before\n\n| h1 | h2 |\n| --- | --- |\n| c1 | c2 |", at: "c2", key: ALT_UP },
  { name: "table-first-block-up-is-noop", markdown: "| h1 | h2 |\n| --- | --- |\n| c1 | c2 |\n\nafter", at: "c1", key: ALT_UP },

  // Insert paragraph
  { name: "paragraph-insert-after", markdown: "one\n\ntwo\n\nthree", at: "two", key: MOD_ENTER },
  { name: "paragraph-insert-before", markdown: "one\n\ntwo\n\nthree", at: "two", key: MOD_SHIFT_ENTER },
  { name: "heading-insert-after-at-document-end", markdown: "# Title", at: "Title", key: MOD_ENTER },
  { name: "first-block-insert-before", markdown: "one\n\ntwo", at: "one", key: MOD_SHIFT_ENTER },
  { name: "list-item-insert-after-leaves-the-list", markdown: "- a\n- b\n\nafter", at: "a", key: MOD_ENTER },
  { name: "list-item-insert-before-leaves-the-list", markdown: "intro\n\n- a\n- b", at: "b", key: MOD_SHIFT_ENTER },
  { name: "table-cell-insert-after-at-document-end", markdown: "| h1 | h2 |\n| --- | --- |\n| c1 | c2 |", at: "c1", key: MOD_ENTER },
  { name: "blockquote-insert-after", markdown: "> quoted\n\nplain", at: "quoted", key: MOD_ENTER },

  // Code block: Mod-Enter stays core's exitCode
  { name: "code-block-mod-enter-is-exit-code", markdown: "```js\nconst a = 1;\n```", at: "const", key: MOD_ENTER },
  { name: "code-block-mod-shift-enter-inserts-before", markdown: "```js\nconst a = 1;\n```", at: "const", key: MOD_SHIFT_ENTER },

  // HardBreak: Shift-Enter must stay a hard break
  { name: "shift-enter-is-still-hard-break", markdown: "one\n\ntwo", at: "two", key: SHIFT_ENTER },
];

function findTextPos(editor: Editor, query: string): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found !== -1) return false;
    if (node.isText && node.text && node.text.includes(query)) {
      found = pos + node.text.indexOf(query);
      return false;
    }
    return true;
  });
  return found;
}

function dispatchKey(editor: Editor, spec: KeySpec): boolean {
  let handled = false;
  const event = new (globalThis as any).window.KeyboardEvent("keydown", {
    key: spec.key,
    altKey: !!spec.alt,
    shiftKey: !!spec.shift,
    ctrlKey: !!spec.mod,
    bubbles: true,
    cancelable: true,
  });
  editor.view.someProp("handleKeyDown", (f: any) => {
    if (f(editor.view, event)) {
      handled = true;
      return true;
    }
    return false;
  });
  return handled;
}

function describeCaret(editor: Editor): string {
  const { $from } = editor.state.selection;
  const parent = $from.parent;
  const text = parent.textContent;
  return `${parent.type.name} ${text === "" ? "(empty)" : JSON.stringify(text)}`;
}

function indent(markdown: string): string {
  return markdown.split("\n").map((l) => `    ${l}`).join("\n");
}

export function runBlockKeysSeam(): string {
  const lines: string[] = [
    "block-keys seam: BlockKeysExtension (src/webview/block-keys-extension.ts)",
    "verifies Alt-ArrowUp/Down block moves and Mod-(Shift-)Enter paragraph insertion (#178)",
    "",
  ];

  CASES.forEach((c, i) => {
    lines.push(`[case ${i + 1}: ${c.name}]`);
    const { editor, dispose } = createHarnessEditor({ content: c.markdown });
    try {
      transformTableCellsAfterParse(editor);
      editor.commands.setTextSelection(findTextPos(editor, c.at));
      // Taken AFTER the first transaction: StarterKit's trailing node appends an
      // empty paragraph on it when the document ends in a list, table, heading or
      // code block (measured: "- a\n- b" becomes "- a\n- b\n"). Reading before
      // would call every such no-op a change. It is upstream, and it is also what
      // the webview serializes once the user has put the caret anywhere.
      const before = editor.getMarkdown();
      const handled = dispatchKey(editor, c.key);
      const after = editor.getMarkdown();
      lines.push(`  key: ${c.key.label}`);
      lines.push(`  cursor before: ${c.at}`);
      lines.push(`  handled: ${handled ? "yes" : "no"}`);
      lines.push(`  document changed: ${after === before ? "no" : "yes"}`);
      lines.push(`  caret after: ${describeCaret(editor)}`);
      lines.push(`  markdown:\n${indent(after)}`);
    } finally {
      dispose();
    }
    lines.push("");
  });

  return lines.join("\n") + "\n";
}
