# Báo cáo W5: #178 thao tác block bằng bàn phím (chuyển block lên/xuống, chèn đoạn trống)

Nhánh: `wave11/w5-block-keys` (tách từ `develop` tại `f2bd057`).
Mọi khối mã nguồn và danh sách tên dưới đây được sinh trực tiếp bằng `sed -n` và `grep` từ file thật.

## 1. Những gì đã làm và danh sách file / hàm

### Danh sách file thay đổi trên nhánh

Lệnh:
```sh
git diff --name-only f2bd057..HEAD
```

Output:
```
harness/block-keys-seam.ts
harness/golden/seams/block-keys.txt
src/webview/block-keys-extension.ts
src/webview/extension-factory.ts
```

### Danh sách hàm và hằng trong `src/webview/block-keys-extension.ts`

Lệnh:
```sh
grep -nE "^(export )?(function|const) " src/webview/block-keys-extension.ts
```

Output:
```
46:const ITEM_TYPES = ['listItem', 'taskItem'];
48:function isItemList(node: PMNode): boolean {
52:function isDoc(node: PMNode): boolean {
57:function moveRange(state: EditorState) {
63:function shiftedSelection(tr: Transaction, selection: Selection, shift: number): Selection {
78:export function moveBlock(state: EditorState, dispatch: ((tr: Transaction) => void) | undefined, dir: -1 | 1): boolean {
104:export function insertParagraph(state: EditorState, dispatch: ((tr: Transaction) => void) | undefined, where: 'after' | 'before'): boolean {
126:export const BlockKeysExtension = Extension.create({
```

### Đăng ký trong `src/webview/extension-factory.ts`

Lệnh:
```sh
grep -n "BlockKeysExtension" src/webview/extension-factory.ts
```

Output:
```
66:import { BlockKeysExtension } from "./block-keys-extension";
397:    BlockKeysExtension,
```

Khối đăng ký trong `src/webview/extension-factory.ts` (`sed -n '395,404p' src/webview/extension-factory.ts`):

```ts
    CustomOrderedList,
    ListKeymapExtension,
    BlockKeysExtension,
    Markdown.configure({
      marked: customMarked,
      indentation,
      markedOptions: {
        gfm: true,
        breaks: false,
      },
```

### Mã nguồn `src/webview/block-keys-extension.ts` (`sed -n '46,144p' src/webview/block-keys-extension.ts`)

```ts
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
```

## 2. Quyết định thiết kế và lý do

1. **`Alt+↑` / `Alt+↓` trong danh sách (`listItem` / `taskItem`) so với ngoài danh sách**:
   - Hàm `moveRange` (`$from.blockRange($to, isItemList) ?? $from.blockRange($to, isDoc)`) ưu tiên tìm dải mục con trong danh sách gần nhất chứa con trỏ (`isItemList`), nếu không ở trong danh sách mới lấy block cấp cao nhất dưới `doc` (`isDoc`).
   - Lý do: khi con trỏ đặt trong một mục danh sách, mục đó là đơn vị mà người dùng đang trỏ vào; nếu `Alt+↑/↓` chuyển cả danh sách thì không có cách nào sắp xếp lại từng mục bằng bàn phím. Mục danh sách không bao giờ nhảy ra khỏi danh sách của nó: ở mục đầu tiên nhấn `Alt+↑` hoặc ở mục cuối cùng nhấn `Alt+↓` là no-op (ca 11, 12, 15).
   - Hệ quả đánh đổi: không chuyển cả khối danh sách bằng `Alt+↑/↓` khi con trỏ ở trong danh sách (kéo cả danh sách vẫn thực hiện được qua drag handle). Phương án "ở giữa danh sách thì chuyển item, chạm mép danh sách thì chuyển cả danh sách" bị loại vì cùng một phím đổi đơn vị tác động giữa chừng.
2. **`Alt+↑` / `Alt+↓` trong ô bảng (`tableCell` / `tableHeader`)**:
   - Khi con trỏ ở trong ô bảng (và không nằm trong danh sách lồng bên trong ô), `isItemList` không khớp nên `moveRange` rơi về `isDoc` (độ sâu 1 — nút `table`). Do đó `Alt+↑/↓` chuyển **cả bảng** lên/xuống một vị trí như một block cấp cao nhất, tuyệt đối không chuyển hàng bảng (ca 17, 18, 19).
3. **Đầu/cuối tài liệu (hoặc đầu/cuối danh sách)**:
   - Khi không có block/item liền kề theo hướng di chuyển (`!hasNeighbour`), `moveBlock` trả `true` (`handled: yes`) mà không tạo transaction và không ném lỗi. Việc nuốt phím ở mép ngăn trình duyệt (đặc biệt trên macOS, nơi `Alt+ArrowUp/Down` mặc định nhảy con trỏ về đầu/cuối đoạn) thực hiện hành vi thứ hai chỉ khi chạm mép.
4. **`Mod+Enter` / `Mod+Shift+Enter` (chèn đoạn trống sau/trước)**:
   - `insertParagraph` luôn tính vị trí theo block cấp cao nhất (`selection.$to.after(1)` cho `'after'`, `selection.$from.before(1)` cho `'before'`; hỗ trợ cả `depth === 0` khi selection là `NodeSelection` ở cấp `doc` hoặc `AllSelection`), chèn một node `paragraph` rỗng và đặt `TextSelection` vào bên trong nó (`pos + 1`).
   - Khi con trỏ ở trong list item hoặc ô bảng, đoạn trống mới được chèn ngay sau/trước toàn bộ list hoặc bảng (ca 24, 25, 26) — đây cũng là cách thoát bằng bàn phím khỏi một bảng nằm ở cuối tài liệu.
5. **Bảo toàn selection khi chuyển block**:
   - `shiftedSelection` dịch chuyển `TextSelection` (`anchor + shift`, `head + shift`) và `NodeSelection` (`from + shift`) theo đúng `dir * neighbour.nodeSize`, hoặc thu về `Selection.near` với các loại selection khác (`CellSelection`, `AllSelection`).

## 3. Các xung đột đã đo trước khi chọn

### 3.1. Tiptap `HardBreak` (`node_modules/@tiptap/extension-hard-break`)

Kiểm tra phiên bản và phím tắt trong `node_modules/@tiptap/extension-hard-break`:

Lệnh:
```sh
grep -n '"version"' node_modules/@tiptap/extension-hard-break/package.json
sed -n '115,120p' node_modules/@tiptap/extension-hard-break/src/hard-break.ts
```

Output:
```
3:  "version": "3.30.1",
  addKeyboardShortcuts() {
    return {
      'Mod-Enter': () => this.editor.commands.setHardBreak(),
      'Shift-Enter': () => this.editor.commands.setHardBreak(),
    }
  },
```

- Kết quả đo: Trong `@tiptap/extension-hard-break` v3.30.1 (được nạp qua `StarterKit`), `HardBreak` thật sự gán cả `'Mod-Enter'` lẫn `'Shift-Enter'` vào `setHardBreak()`.
- Quyết định: Theo đúng đặc tả #178 và `TASK.md`, `BlockKeysExtension` đặt `priority: 1000` để nhận `'Mod-Enter'` trước `HardBreak` (tước hard break khỏi `Mod+Enter` để chèn đoạn trống sau block), trong khi `'Shift-Enter'` giữ nguyên cho `HardBreak` (được kiểm chứng ở ca 30 `shift-enter-is-still-hard-break`).

### 3.2. Code block và `@tiptap/core` Keymap (`exitCode`)

Kiểm tra trong `@tiptap/extension-code-block` và `@tiptap/core`:

Lệnh:
```sh
grep -n "Enter" node_modules/@tiptap/extension-code-block/src/code-block.ts
sed -n '69,75p' node_modules/@tiptap/core/src/extensions/keymap.ts
```

Output:
```
16:  exitOnTripleEnter: boolean | null | undefined
90:      exitOnTripleEnter: true,
340:      Enter: ({ editor }) => {
341:        if (!this.options.exitOnTripleEnter) {
    const baseKeymap = {
      Enter: handleEnter,
      'Mod-Enter': () => this.editor.commands.exitCode(),
      Backspace: handleBackspace,
      'Mod-Backspace': handleBackspace,
      'Shift-Backspace': handleBackspace,
      Delete: handleDelete,
```

- Kết quả đo: `CodeBlock` chỉ xử lý `Enter` (`exitOnTripleEnter`), còn `'Mod-Enter'` nằm trong `baseKeymap` của `@tiptap/core` (`this.editor.commands.exitCode()`).
- Thứ tự ưu tiên chọn: Trong `'Mod-Enter'`, nếu `this.editor.state.selection.$from.parent.type.name === 'codeBlock'` (`inCodeBlock()`), `BlockKeysExtension` trả `false` để nhường cho `exitCode()` của core (ca 28 `code-block-mod-enter-is-exit-code`). Còn `'Mod-Shift-Enter'` không có binding upstream nên chèn đoạn trống trước `codeBlock` (ca 29 `code-block-mod-shift-enter-inserts-before`).
- Ghi chú đo đạc: Với `codeBlock` ở cấp cao nhất (`depth === 1`), `exitCode` của `prosemirror-commands` (chèn đoạn mặc định tại `$head.after()`) và `insertParagraph(..., 'after')` (`$to.after(1)`) tạo ra cùng tài liệu và cùng vị trí con trỏ, nên phép thử răng bỏ nhánh `inCodeBlock()` (T5) cho 0/30 ca đổi; nhánh nhường vẫn được giữ để ghim hành vi upstream.

### 3.3. Thứ tự ưu tiên (`priority: 1000`) so với vị trí đăng ký trong `extension-factory.ts`

- Đo thực nghiệm: Khi `BlockKeysExtension` đặt sau `StarterKit` trong `buildMarkdownExtensions()`, plugin keymap của nó đã đứng trước `HardBreak` trong danh sách plugin ProseMirror nên bỏ `priority: 1000` (T4) cho 0/30 ca đổi. Tuy nhiên, nếu vừa bỏ `priority: 1000` vừa đặt `BlockKeysExtension` **trước** `StarterKit` (T8), `HardBreak` chạy trước và làm hỏng 5/30 ca `Mod+Enter` (`+12 -13 lines`); giữ `priority: 1000` và đặt trước `StarterKit` (T9) thì 0/30 ca đổi. Do đó `priority: 1000` là chốt bảo vệ thứ tự ưu tiên độc lập với vị trí trong mảng extension.

### 3.4. `src/webview/list-keymap-extension.ts`

Lệnh:
```sh
grep -nE "Tab|Enter|Arrow" src/webview/list-keymap-extension.ts
```

Output:
```
4: * Registered after StarterKit and Table so it intercepts Tab and Shift-Tab
5: * before Table's default cell navigation and StarterKit's list handling:
8: *   2. Table cells: try sinking/lifting list items first; fall back to
9: *      goToNextCell on Tab (at cell 1 or not in list) and goToPreviousCell
10: *      on Shift-Tab (at top-level item or not in list).
24:export function isInsideTable(state: EditorState): boolean {
35:export function goToNextTableCell(editor: Editor): boolean {
196:      Tab: ({ editor }) => {
198:        const inTable = isInsideTable(state);
220:            if (inTable) {
222:              return goToNextTableCell(editor);
229:        if (inTable) {
230:          return goToNextTableCell(editor);
236:      'Shift-Tab': ({ editor }) => {
238:        const inTable = isInsideTable(state);
256:        if (inTable) {
```

- `ListKeymapExtension` chỉ đăng ký `Tab` và `Shift-Tab`, không trùng phím nào với `BlockKeysExtension`. Không sửa `src/webview/list-keymap-extension.ts`, và golden `harness/golden/seams/list-keys.txt` giữ nguyên.

### 3.5. Quan sát phụ về `TrailingNode` của `StarterKit`

- `StarterKit` bật sẵn `TrailingNode` (`node_modules/@tiptap/starter-kit/src/starter-kit.ts`). Khi tài liệu kết thúc bằng list, bảng, heading hoặc code block, giao dịch đầu tiên (`setTextSelection`) kích hoạt `appendTransaction` của `TrailingNode` và chèn một đoạn trống cuối tài liệu (khiến `editor.getMarkdown()` có thêm `\n` so với trước `setTextSelection`).
- Trong `harness/block-keys-seam.ts`, `const before = editor.getMarkdown()` được lấy **sau** `editor.commands.setTextSelection(...)` (`sed -n '146,155p' harness/block-keys-seam.ts`) để so sánh trạng thái tài liệu trước và sau khi nhấn phím trên cùng một mặt bằng, tránh báo sai các ca no-op ở cuối tài liệu thành `document changed: yes`:

```ts
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
```

## 4. Những điểm CHƯA kiểm được và lý do

1. **Trong webview của VS Code, `Alt+↑` / `Alt+↓` có tới được webview không hay bị workbench nuốt mất**: **chưa kiểm được**.
   - Lý do: Seam `harness/block-keys-seam.ts` chạy trong jsdom trên Node, không có tầng keybinding của VS Code workbench (vốn mặc định gán `Alt+Up` / `Alt+Down` cho `editor.action.moveLinesUpAction` / `moveLinesDownAction` khi điều kiện `editorTextFocus` khớp). Còn `verify:vscode-floor` chạy trên VS Code thật nhưng ràng buộc 8 của `COMMON.md` cấm worker sửa `harness/vscode-floor/run.mjs` và `extension-tests.ts`. Đặc tả floor check cho điểm này được viết ở Mục 7.
2. **Hành vi trình duyệt trên macOS khi nhấn `Alt+↑` / `Alt+↓` ở đầu/cuối tài liệu**: **chưa kiểm được** trên macOS thật (môi trường chạy là Linux headless). Seam đã kiểm tra `handled: yes` (hàm trả `true` để gọi `preventDefault()`).
3. **Tương tác khi popup gợi ý (`suggestion-popup.ts`) đang mở**: **chưa kiểm được** trên trình duyệt thật. Qua đọc mã (`sed -n '168,203p' src/webview/suggestion-popup.ts`), `SuggestionPopup.onKeyDown` kiểm tra `event.key === "ArrowDown"`, `"ArrowUp"`, `"Enter"` mà không kiểm tra modifier (`altKey`, `ctrlKey`, `metaKey`), nên khi popup `/`, `@`, `[[`, `:` đang mở và plugin suggestion đăng ký sau được gọi trước, phím có thể bị popup xử lý. Không chạm vào `src/webview/suggestion-popup.ts` vì nằm ngoài phạm vi sở hữu của W5.

## 5. Seam `harness/block-keys-seam.ts` và chứng minh có răng

### 5.1. Danh sách 30 ca trong `harness/block-keys-seam.ts`

Lệnh:
```sh
grep -n "{ name:" harness/block-keys-seam.ts
```

Output:
```
48:  { name: "paragraph-down-mid-document", markdown: "one\n\ntwo\n\nthree", at: "two", key: ALT_DOWN },
49:  { name: "paragraph-up-mid-document", markdown: "one\n\ntwo\n\nthree", at: "two", key: ALT_UP },
50:  { name: "first-block-up-is-noop", markdown: "one\n\ntwo\n\nthree", at: "one", key: ALT_UP },
51:  { name: "last-block-down-is-noop", markdown: "one\n\ntwo\n\nthree", at: "three", key: ALT_DOWN },
52:  { name: "single-block-document-up", markdown: "only", at: "only", key: ALT_UP },
53:  { name: "heading-down", markdown: "# Title\n\nbody\n\nlast", at: "Title", key: ALT_DOWN },
54:  { name: "code-block-up", markdown: "intro\n\n```js\nconst a = 1;\n```\n\nafter", at: "const", key: ALT_UP },
55:  { name: "blockquote-down", markdown: "> quoted\n\nplain", at: "quoted", key: ALT_DOWN },
58:  { name: "list-item-down", markdown: "- a\n- b\n- c", at: "a", key: ALT_DOWN },
59:  { name: "list-item-up", markdown: "- a\n- b\n- c", at: "c", key: ALT_UP },
60:  { name: "list-first-item-up-is-noop", markdown: "intro\n\n- a\n- b", at: "a", key: ALT_UP },
61:  { name: "list-last-item-down-is-noop", markdown: "- a\n- b\n\noutro", at: "b", key: ALT_DOWN },
62:  { name: "ordered-item-down-renumbers", markdown: "1. a\n2. b\n3. c", at: "a", key: ALT_DOWN },
63:  { name: "nested-item-down", markdown: "- top\n  - x\n  - y\n- other", at: "x", key: ALT_DOWN },
64:  { name: "nested-last-item-down-is-noop", markdown: "- top\n  - x\n  - y\n- other", at: "y", key: ALT_DOWN },
65:  { name: "task-item-up", markdown: "- [ ] one\n- [x] two", at: "two", key: ALT_UP },
68:  { name: "table-cell-down-moves-table", markdown: "| h1 | h2 |\n| --- | --- |\n| c1 | c2 |\n\nafter", at: "c1", key: ALT_DOWN },
69:  { name: "table-cell-up-moves-table", markdown: "before\n\n| h1 | h2 |\n| --- | --- |\n| c1 | c2 |", at: "c2", key: ALT_UP },
70:  { name: "table-first-block-up-is-noop", markdown: "| h1 | h2 |\n| --- | --- |\n| c1 | c2 |\n\nafter", at: "c1", key: ALT_UP },
73:  { name: "paragraph-insert-after", markdown: "one\n\ntwo\n\nthree", at: "two", key: MOD_ENTER },
74:  { name: "paragraph-insert-before", markdown: "one\n\ntwo\n\nthree", at: "two", key: MOD_SHIFT_ENTER },
75:  { name: "heading-insert-after-at-document-end", markdown: "# Title", at: "Title", key: MOD_ENTER },
76:  { name: "first-block-insert-before", markdown: "one\n\ntwo", at: "one", key: MOD_SHIFT_ENTER },
77:  { name: "list-item-insert-after-leaves-the-list", markdown: "- a\n- b\n\nafter", at: "a", key: MOD_ENTER },
78:  { name: "list-item-insert-before-leaves-the-list", markdown: "intro\n\n- a\n- b", at: "b", key: MOD_SHIFT_ENTER },
79:  { name: "table-cell-insert-after-at-document-end", markdown: "| h1 | h2 |\n| --- | --- |\n| c1 | c2 |", at: "c1", key: MOD_ENTER },
80:  { name: "blockquote-insert-after", markdown: "> quoted\n\nplain", at: "quoted", key: MOD_ENTER },
83:  { name: "code-block-mod-enter-is-exit-code", markdown: "```js\nconst a = 1;\n```", at: "const", key: MOD_ENTER },
84:  { name: "code-block-mod-shift-enter-inserts-before", markdown: "```js\nconst a = 1;\n```", at: "const", key: MOD_SHIFT_ENTER },
87:  { name: "shift-enter-is-still-hard-break", markdown: "one\n\ntwo", at: "two", key: SHIFT_ENTER },
```

Thống kê `document changed` trong `harness/golden/seams/block-keys.txt`:

Lệnh:
```sh
grep -c "document changed: yes" harness/golden/seams/block-keys.txt
grep -c "document changed: no" harness/golden/seams/block-keys.txt
grep -n "document changed: no" -B3 harness/golden/seams/block-keys.txt | grep "\[case"
```

Output:
```
23
7
```

7 ca `document changed: no` đều là các ca chặn ở biên đầu/cuối tài liệu hoặc đầu/cuối danh sách (ca 3, 4, 5, 11, 12, 15, 19), có `handled: yes` và không ném lỗi.

### 5.2. Kết quả 9 phép thử răng (Teeth tests)

Quy trình cho từng phép thử răng: sửa trực tiếp file mang cơ chế (`src/webview/extension-factory.ts` hoặc `src/webview/block-keys-extension.ts`), chạy `npm run roundtrip` để lấy dòng `FAIL`, chạy `npm run roundtrip:update` để đếm chính xác bao nhiêu ca trên tổng số 30 ca trong `harness/golden/seams/block-keys.txt` bị đổi so với `HEAD`, sau đó khôi phục cả file nguồn lẫn golden và kiểm tra lại `npm run roundtrip` xanh.

Output thật của loạt chạy kiểm chứng răng:

```
=== T1: Unregister BlockKeysExtension in extension-factory.ts ===
FAIL     seams/block-keys.txt (+73 -84 lines)
45 markdown fixtures + 21 seams: 65 passed, 1 failed, 0 missing, 0 errored
28 of 30 cases changed
  unchanged: [case 28: code-block-mod-enter-is-exit-code]
  unchanged: [case 30: shift-enter-is-still-hard-break]
=== T2: Selection not shifted (dir * neighbour.nodeSize -> 0) ===
FAIL     seams/block-keys.txt (+11 -11 lines)
45 markdown fixtures + 21 seams: 65 passed, 1 failed, 0 missing, 0 errored
11 of 30 cases changed
=== T3: Edge returns false instead of true ===
FAIL     seams/block-keys.txt (+7 -7 lines)
45 markdown fixtures + 21 seams: 65 passed, 1 failed, 0 missing, 0 errored
7 of 30 cases changed
=== T4: Remove priority: 1000 (registered after StarterKit) ===
45 markdown fixtures + 21 seams: 66 passed, 0 failed, 0 missing, 0 errored
0 of 30 cases changed
=== T5: Remove inCodeBlock() carve-out for Mod-Enter ===
45 markdown fixtures + 21 seams: 66 passed, 0 failed, 0 missing, 0 errored
0 of 30 cases changed
=== T6: Remove isItemList (lists move as whole block) ===
FAIL     seams/block-keys.txt (+27 -14 lines)
45 markdown fixtures + 21 seams: 65 passed, 1 failed, 0 missing, 0 errored
8 of 30 cases changed
=== T7: Invert swap order ===
FAIL     seams/block-keys.txt (+42 -44 lines)
45 markdown fixtures + 21 seams: 65 passed, 1 failed, 0 missing, 0 errored
12 of 30 cases changed
=== T8: Remove priority: 1000 AND register before StarterKit ===
FAIL     seams/block-keys.txt (+12 -13 lines)
45 markdown fixtures + 21 seams: 65 passed, 1 failed, 0 missing, 0 errored
5 of 30 cases changed
=== T9: Keep priority: 1000 AND register before StarterKit ===
45 markdown fixtures + 21 seams: 66 passed, 0 failed, 0 missing, 0 errored
0 of 30 cases changed
```

Bảng tổng hợp:

| Mã | Phép phá (trên đúng file mang cơ chế) | Kết quả `npm run roundtrip` | Số ca đổi / 30 |
|---|---|---|---|
| T1 | Gỡ `BlockKeysExtension` khỏi `src/webview/extension-factory.ts` | `FAIL seams/block-keys.txt (+73 -84 lines)` | **28 / 30** |
| T2 | Không dịch selection theo block (`dir * neighbour.nodeSize` → `0`) trong `block-keys-extension.ts` | `FAIL seams/block-keys.txt (+11 -11 lines)` | **11 / 30** |
| T3 | Ở mép trả `false` thay vì `true` (`if (!hasNeighbour) return false;`) | `FAIL seams/block-keys.txt (+7 -7 lines)` | **7 / 30** |
| T4 | Bỏ `priority: 1000` (giữ vị trí đăng ký sau `StarterKit`) | `66 passed, 0 failed` | **0 / 30** |
| T5 | Bỏ `if (inCodeBlock()) return false;` trong `'Mod-Enter'` | `66 passed, 0 failed` | **0 / 30** |
| T6 | Bỏ `$from.blockRange($to, isItemList) ??` (mọi list di chuyển cả khối) | `FAIL seams/block-keys.txt (+27 -14 lines)` | **8 / 30** |
| T7 | Đảo ngược thứ tự mảng hoán đổi `[...moving, neighbour]` ↔ `[neighbour, ...moving]` | `FAIL seams/block-keys.txt (+42 -44 lines)` | **12 / 30** |
| T8 | Bỏ `priority: 1000` VÀ đăng ký `BlockKeysExtension` trước `StarterKit` | `FAIL seams/block-keys.txt (+12 -13 lines)` | **5 / 30** |
| T9 | Giữ `priority: 1000` VÀ đăng ký `BlockKeysExtension` trước `StarterKit` | `66 passed, 0 failed` | **0 / 30** |

Giải thích các ca không đổi ở T1 (khi gỡ `BlockKeysExtension` khỏi factory, 28/30 ca đổi, 2 ca giữ nguyên):
- **Ca 28 (`code-block-mod-enter-is-exit-code`)**: `BlockKeysExtension` chủ đích trả `false` khi con trỏ ở trong `codeBlock`, nên dù có hay không có `BlockKeysExtension`, phím `Mod+Enter` trong `codeBlock` đều do `exitCode()` của `@tiptap/core` Keymap xử lý.
- **Ca 30 (`shift-enter-is-still-hard-break`)**: `BlockKeysExtension` không đăng ký `Shift-Enter`, nên dù có hay không có `BlockKeysExtension`, phím `Shift+Enter` đều do `setHardBreak()` của `@tiptap/extension-hard-break` xử lý.

## 6. Kết quả chuỗi lệnh kiểm tra trước khi `DONE:`

### 6.1. `npm run lint`

Lệnh:
```sh
npm run lint
```

Output:
```
> tui-milkdown-vscode@3.4.2 lint
> tsc --noEmit
```

### 6.2. `npm run build`

Lệnh:
```sh
npm run build
```

Output:
```
> tui-milkdown-vscode@3.4.2 build
> node esbuild.config.js

Building (production)...
Build complete (production)
webview bundle: 1030364 B / 1100000 B budget
```

### 6.3. `npm test`

Lệnh:
```sh
npm test
```

Output (tóm tắt cuối):
```
✔ sameResource matches across the query a reload appends (0.248811ms)
✔ sameResource matches vscode-webview:// against file+ for the same path (1.579534ms)
✔ sameResource does NOT match two different files (0.271992ms)
✔ sameResource does not match unrelated strings just because both fail to parse (0.29877ms)
ℹ tests 98
ℹ suites 27
ℹ pass 98
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 328.405064
```

### 6.4. `npm run roundtrip` (vòng 1)

Lệnh:
```sh
npm run roundtrip
```

Output:
```
> tui-milkdown-vscode@3.4.2 roundtrip
> node esbuild.harness.config.js && node out/harness/roundtrip.js

harness built: out/harness/roundtrip.js
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package
markdown roundtrip harness — mode: check
corpus: 45 fixtures (40 synthetic, 5 repo docs)

──────────────────────────────────────────
──────────────────────────────────────────
45 markdown fixtures + 21 seams: 66 passed, 0 failed, 0 missing, 0 errored
```

### 6.5. Roundtrip vòng hai và bước khôi phục

Lệnh:
```sh
cp harness/golden/synthetic/*.md harness/fixtures/synthetic/ && npm run roundtrip
git checkout -- harness/fixtures/synthetic/
git status --short harness/
```

Output:
```
> tui-milkdown-vscode@3.4.2 roundtrip
> node esbuild.harness.config.js && node out/harness/roundtrip.js

harness built: out/harness/roundtrip.js
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package
markdown roundtrip harness — mode: check
corpus: 45 fixtures (40 synthetic, 5 repo docs)

──────────────────────────────────────────
──────────────────────────────────────────
45 markdown fixtures + 21 seams: 66 passed, 0 failed, 0 missing, 0 errored
```
`git status --short harness/` sau bước `git checkout -- harness/fixtures/synthetic/` hoàn toàn rỗng.

### 6.6. VS Code floor check

Lệnh:
```sh
PUPPETEER_EXECUTABLE_PATH=$HOME/.cache/puppeteer-floor/chrome-nosandbox \
  xvfb-run -a -s "-screen 0 1920x1080x24" npm run verify:vscode-floor
```

Output (tóm tắt cuối):
```
PASS  dragging the handle reorders the block — moved=true draggedBlockChangedIndex=true index 1->19 source="Some bold text" target="[[" dataTransferTypes=""
      before: ▼Heading One|Some bold text|Column AColumn|Task item chec|javascript 1co|flowchart TD
 |#m200-mermaid-|An alert block|||Inline math ab|∫01x2dx\int_0^|
      after:  ▼Heading One|Column AColumn|Task item chec|javascript 1co|flowchart TD
 |#m162-mermaid-|An alert block|||Inline math ab|∫01x2dx\int_0^|MoreHidden bod|
PASS  double-click image rename could be driven — picked the last of 2 icon.png img(s) of 4 total; src was https://file%2B.vscode-resource.vscode-cdn.net/tmp/tuimd-flo...; nodes now on icon-renamed=2 after 252ms (0 means the host never answered or the plugin never updated the node; the host records what the file holds)
PASS  export button could be driven for both formats — clicked #btn-export-go for docx and pdf; the host checks what they wrote
PASS  the Collapsible entry is reachable by the word 'more' and opens what it inserts — filtered=3 first="CollapsibleCollapsib" detailsInDoc=2 domOpen=true documentSaysOpen=false caretInSummary=true
PASS  no CSP violation in the console — 3 console entries, none CSP

63 checks: 63 passed, 0 failed
```

### 6.7. Kiểm tra không sửa fixture cũ so với merge-base

Lệnh:
```sh
MB=$(git merge-base develop HEAD)
git diff $MB..HEAD --stat -- harness/fixtures/synthetic/
```

Output: (rỗng).

### 6.8. Kiểm tra trạng thái git (`git status --short`)

Lệnh:
```sh
git status --short
```

Output: (rỗng — mọi thay đổi và báo cáo đã được commit).

## 7. Đặc tả floor check đề xuất (Ràng buộc 8)

Vì seam chạy trong jsdom nên không chứng minh được phím `Alt+ArrowUp` / `Alt+ArrowDown` và `Mod+Enter` đi qua tầng cửa sổ/webview của VS Code tới ProseMirror trong thực tế. Đề xuất thêm một probe vào `driveSurfaces` trong `harness/vscode-floor/run.mjs`:

- **Tên check**: `Alt+ArrowDown moves the current block and Mod+Enter inserts an empty paragraph after it`
- **Thao tác**:
  1. Trong `driveSurfaces`, đặt caret vào đoạn văn cấp cao nhất đầu tiên dưới heading (`p` chứa `"Some bold text"`, hoặc một đoạn văn xác định qua `Runtime.evaluate`), ghi nhận mảng thứ tự các block con trực tiếp của `.tiptap` (`beforeOrder = Array.from(document.querySelectorAll('.tiptap > *')).map(el => el.tagName + ':' + (el.textContent || '').trim().slice(0, 14))`) và số lượng phần tử con (`beforeCount`).
  2. Gửi sự kiện phím thật qua CDP `session.send("Input.dispatchKeyEvent", ...)` (`keyDown` + `keyUp`) cho `Alt+ArrowDown`: `key: "ArrowDown"`, `code: "ArrowDown"`, `windowsVirtualKeyCode: 40`, `nativeVirtualKeyCode: 40`, `modifiers: 1` (`Alt`).
  3. Đọc lại thứ tự các block con của `.tiptap` (`afterMoveOrder`) và phần tử đang chứa selection (`activeAfterMove`).
  4. Gửi tiếp `Alt+ArrowUp` (`key: "ArrowUp"`, `code: "ArrowUp"`, `windowsVirtualKeyCode: 38`, `nativeVirtualKeyCode: 38`, `modifiers: 1`) để trả đoạn văn về chỗ cũ (tránh làm xô lệch thứ tự các probe phía sau).
  5. Gửi `Mod+Enter` (`key: "Enter"`, `code: "Enter"`, `windowsVirtualKeyCode: 13`, `nativeVirtualKeyCode: 13`, `modifiers: process.platform === "darwin" ? 4 : 2`). Đọc số lượng phần tử con (`afterInsertCount`), kiểm tra phần tử ngay sau đoạn văn vừa đứng là `<p>` rỗng và selection đang nằm trong `<p>` rỗng đó; sau đó gửi `Backspace` để xóa đoạn trống vừa chèn.
- **Đọc gì và khẳng định gì**:
  - Sau bước 2: vị trí của đoạn văn trong `afterMoveOrder` tăng thêm 1 (`indexBefore + 1 === indexAfterMove`), phần tử liền sau đổi chỗ lên `indexBefore`, và `activeAfterMove` vẫn nằm trong đoạn văn đó.
  - Sau bước 4: thứ tự quay về `beforeOrder`.
  - Sau bước 5: `afterInsertCount === beforeCount + 1`, phần tử tại `indexBefore + 1` là `P:` rỗng (chứ không phải thẻ `<br>` bên trong đoạn cũ), và caret nằm trong đoạn `<p>` mới đó.
- **Phá cái gì thì nó phải đỏ**:
  1. Gỡ `BlockKeysExtension` khỏi `buildMarkdownExtensions()` trong `src/webview/extension-factory.ts`: bước 2 không đổi thứ tự (`indexAfterMove === indexBefore`), và bước 5 chèn `<br>` (`HardBreak`) vào trong đoạn văn hiện tại thay vì tăng `afterInsertCount`.
  2. Hoặc nếu VS Code workbench chặn `Alt+ArrowDown` trước khi sự kiện vào webview target: bước 2 không đổi `afterMoveOrder` và check báo đỏ ngay.

## 8. Câu chữ đề xuất cho tài liệu gốc (Ràng buộc 1)

### 8.1. `CHANGELOG.md` (dưới mục `## [Unreleased]` → `### Added`)

- **Move blocks and list items, and insert empty paragraphs from the keyboard (#178).** `Alt+Up` and `Alt+Down` move the current block up or down one place, or the current list item within its list when the caret is inside a list; inside a table cell without a list, the whole table moves. `Ctrl/Cmd+Enter` and `Ctrl/Cmd+Shift+Enter` insert an empty paragraph after or before the top-level block and place the caret in it, except inside a code block where `Ctrl/Cmd+Enter` keeps its existing exit-code behaviour. `Shift+Enter` continues to insert a hard line break.

### 8.2. `README.md` (dưới mục `### Rich Text Editing`)

- **Keyboard Block Operations**: `Alt+↑` / `Alt+↓` to move the current block (or list item) up or down; `Ctrl/Cmd+Enter` and `Ctrl/Cmd+Shift+Enter` to insert an empty paragraph after or before the current block

### 8.3. `AGENTS.md`

- Trong `## File Structure` (`src/webview/`):
  `├── block-keys-extension.ts # Alt+Up/Down block/list-item move and Mod+(Shift+)Enter paragraph insert (#178)`
- Trong `## File Structure` (`harness/`):
  `├── block-keys-seam.ts              # Keyboard block move and paragraph insert markdown/caret seam (#178)`
- Trong `## Tiptap Integration` (`**Extensions:**`):
  Thêm `BlockKeysExtension (Alt+Up/Down block and list-item move, Mod+Enter / Mod+Shift+Enter empty paragraph insert, priority 1000 above HardBreak while yielding Mod+Enter inside codeBlock to exitCode, #178)`
