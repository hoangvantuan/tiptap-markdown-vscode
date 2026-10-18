/**
 * Keyboard block operations (#178): move a block up/down, insert an empty
 * paragraph after/before the current block. Until now only the drag handle did
 * the first, and nothing did the second without a mouse.
 *
 *   Alt-ArrowUp / Alt-ArrowDown     move the unit under the cursor one place
 *   Mod-Enter / Mod-Shift-Enter     empty paragraph after / before the block
 *
 * What "the unit" and "the block" are, and why:
 *   - Move: the innermost list item (listItem / taskItem) when the cursor is in
 *     one, otherwise the top-level block. Moving a whole list for a keypress made
 *     inside one of its items would make the item itself unmovable, and an item
 *     is what the user is pointing at. An item never leaves its list: at the
 *     first/last item the key does nothing (the drag handle moves a whole list).
 *     A table cell without a list moves the whole table, never a row: the
 *     top-level block rule applies, and a row move is a different feature.
 *   - Insert: always the top-level block, so Mod-Enter in a list item or a table
 *     cell lands after the list or table. That is the only keyboard way out of a
 *     table that ends the document.
 *   - At the first/last position the move key is SWALLOWED (returns true), not
 *     ignored: on macOS the browser would otherwise run its own Alt-Arrow caret
 *     jump at the document edge only, and the key would mean two things.
 *
 * Conflicts, measured rather than assumed (see harness/block-keys-seam.ts):
 *   - HardBreak (StarterKit) binds Mod-Enter AND Shift-Enter to setHardBreak.
 *     This extension takes Mod-Enter from it; Shift-Enter stays a hard break.
 *   - Core's Keymap binds Mod-Enter to exitCode, and a code block relies on it.
 *     Mod-Enter in a code block returns false here so exitCode keeps it.
 *     Mod-Shift-Enter has no upstream binding, so it inserts before the block.
 *   - list-keymap-extension.ts owns Tab/Shift-Tab and shares no key with this.
 *
 * Priority is above the default so this runs before HardBreak's Mod-Enter. It
 * changes the document, so it is registered in buildMarkdownExtensions().
 */
import { Extension } from '@tiptap/core';
import { Fragment } from '@tiptap/pm/model';
import { NodeSelection, Selection, TextSelection } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';

const ITEM_TYPES = ['listItem', 'taskItem'];

function isItemList(node: PMNode): boolean {
  return node.childCount > 0 && ITEM_TYPES.includes(node.firstChild!.type.name);
}

function isDoc(node: PMNode): boolean {
  return node.type.name === 'doc';
}

/** The run of siblings to move: items of the innermost list, else top-level blocks. */
function moveRange(state: EditorState) {
  const { $from, $to } = state.selection;
  return $from.blockRange($to, isItemList) ?? $from.blockRange($to, isDoc);
}

/** Re-create the selection `shift` positions later, whatever its kind. */
function shiftedSelection(tr: Transaction, selection: Selection, shift: number): Selection {
  if (selection instanceof TextSelection) {
    return TextSelection.create(tr.doc, selection.anchor + shift, selection.head + shift);
  }
  if (selection instanceof NodeSelection) {
    return NodeSelection.create(tr.doc, selection.from + shift);
  }
  // CellSelection, AllSelection: collapse near where the range landed.
  return Selection.near(tr.doc.resolve(selection.from + shift));
}

/**
 * Swap the selected run with the sibling above (-1) or below (1). Returns true
 * when the key was consumed, including the no-op at an edge.
 */
export function moveBlock(state: EditorState, dispatch: ((tr: Transaction) => void) | undefined, dir: -1 | 1): boolean {
  const range = moveRange(state);
  // No range means the selection is not inside any block we can move (it cannot
  // happen with a doc root, but a missing answer must not throw).
  if (!range) return false;

  const { parent, startIndex, endIndex, start, end } = range;
  const hasNeighbour = dir === -1 ? startIndex > 0 : endIndex < parent.childCount;
  if (!hasNeighbour) return true;

  if (dispatch) {
    const neighbour = parent.child(dir === -1 ? startIndex - 1 : endIndex);
    const moving: PMNode[] = [];
    for (let i = startIndex; i < endIndex; i++) moving.push(parent.child(i));
    const from = dir === -1 ? start - neighbour.nodeSize : start;
    const to = dir === -1 ? end : end + neighbour.nodeSize;
    const swapped = dir === -1 ? [...moving, neighbour] : [neighbour, ...moving];

    const tr = state.tr.replaceWith(from, to, Fragment.from(swapped));
    tr.setSelection(shiftedSelection(tr, state.selection, dir * neighbour.nodeSize));
    dispatch(tr.scrollIntoView());
  }
  return true;
}

/** Insert an empty paragraph after/before the top-level block and put the caret in it. */
export function insertParagraph(state: EditorState, dispatch: ((tr: Transaction) => void) | undefined, where: 'after' | 'before'): boolean {
  const { selection } = state;
  const paragraph = state.schema.nodes.paragraph;
  if (!paragraph) return false;

  // A selection that sits between top-level blocks (NodeSelection of one, or
  // AllSelection) has depth 0: the block is the node after $from / before $to.
  let pos: number;
  if (where === 'after') {
    pos = selection.$to.depth === 0 ? selection.$to.pos : selection.$to.after(1);
  } else {
    pos = selection.$from.depth === 0 ? selection.$from.pos : selection.$from.before(1);
  }

  if (dispatch) {
    const tr = state.tr.insert(pos, paragraph.create());
    tr.setSelection(TextSelection.create(tr.doc, pos + 1));
    dispatch(tr.scrollIntoView());
  }
  return true;
}

export const BlockKeysExtension = Extension.create({
  name: 'blockKeys',
  priority: 1000,

  addKeyboardShortcuts() {
    const inCodeBlock = () => this.editor.state.selection.$from.parent.type.name === 'codeBlock';
    return {
      'Alt-ArrowUp': () => this.editor.commands.command(({ state, dispatch }) => moveBlock(state, dispatch, -1)),
      'Alt-ArrowDown': () => this.editor.commands.command(({ state, dispatch }) => moveBlock(state, dispatch, 1)),
      // exitCode (core Keymap) keeps Mod-Enter inside a code block.
      'Mod-Enter': () => {
        if (inCodeBlock()) return false;
        return this.editor.commands.command(({ state, dispatch }) => insertParagraph(state, dispatch, 'after'));
      },
      'Mod-Shift-Enter': () =>
        this.editor.commands.command(({ state, dispatch }) => insertParagraph(state, dispatch, 'before')),
    };
  },
});
