# Báo cáo W2 (Sóng 11): #170 và #171 — Fragment `#heading` trong wiki link và markdown link sang file khác

## 1. Tóm tắt thay đổi và danh sách commit

Lệnh kiểm tra lịch sử commit và danh sách file thay đổi từ mốc `f2bd057`:

```text
$ git log --oneline f2bd057..HEAD
7c4ccea feat(links): follow cross-file #heading fragments and scroll to target (#171)
55df6a4 fix(wiki-link): resolve [[Note#Heading]] to Note.md, never offer a # file (#170)
$ git diff --name-status f2bd057..HEAD
A	harness/fixtures/synthetic/wiki-link-fragment.md
A	harness/golden/synthetic/wiki-link-fragment.md
A	src/host/fragmentNavigation.ts
M	src/host/messageHandlers.ts
M	src/host/openLocalFile.ts
M	src/host/openWikiLink.ts
M	src/markdownEditorProvider.ts
M	src/shared/messages.ts
M	src/webview/heading-slug.ts
M	src/webview/main.ts
A	test/heading-fragment.test.ts
A	test/wiki-link-fragment.test.ts
```

### Danh sách tên (message, hàm, file) sinh bằng `grep`

```text
$ grep -n "ScrollToMessage\|type: \"scrollTo\"" src/shared/messages.ts src/host/fragmentNavigation.ts src/host/messageHandlers.ts
src/shared/messages.ts:235:export interface ScrollToMessage {
src/shared/messages.ts:236:  type: "scrollTo";
src/shared/messages.ts:257:  | ScrollToMessage;
src/host/fragmentNavigation.ts:176:    target?.webview.postMessage({ type: "scrollTo", fragment });
src/host/messageHandlers.ts:77:      ctx.webview.postMessage({ type: "scrollTo", fragment });
$ grep -n "^export " src/host/openWikiLink.ts src/host/openLocalFile.ts src/host/fragmentNavigation.ts src/webview/heading-slug.ts
src/host/openWikiLink.ts:37:export interface WikiTarget {
src/host/openWikiLink.ts:50:export function splitWikiTarget(raw: string): WikiTarget {
src/host/openWikiLink.ts:61:export async function openWikiLink(
src/host/openLocalFile.ts:20:export function openLocalFileInEditor(
src/host/fragmentNavigation.ts:32:export interface ScrollTargetPanel {
src/host/fragmentNavigation.ts:51:export function fragmentDocKey(uri: vscode.Uri): string {
src/host/fragmentNavigation.ts:57:export function isMarkdownPath(filePath: string): boolean {
src/host/fragmentNavigation.ts:65:export function registerScrollTarget(
src/host/fragmentNavigation.ts:89:export function takePendingFragment(uri: vscode.Uri): string | undefined {
src/host/fragmentNavigation.ts:97:export function resetFragmentNavigation(): void {
src/host/fragmentNavigation.ts:108:export function findHeadingLine(text: string, fragment: string): number {
src/host/fragmentNavigation.ts:154:export async function openWithFragment(
src/webview/heading-slug.ts:16:export function headingSlug(text: string): string {
src/webview/heading-slug.ts:39:export function fragmentMatchesHeading(fragment: string, headingText: string): boolean {
src/webview/heading-slug.ts:54:export interface HeadingSearchDoc {
src/webview/heading-slug.ts:67:export function findHeadingOffset(doc: HeadingSearchDoc, fragment: string): number {
src/webview/heading-slug.ts:81:export interface ScrollableHeadingEditor {
src/webview/heading-slug.ts:87:export interface ScrollEditorToHeadingOptions {
src/webview/heading-slug.ts:106:export function scrollEditorToHeading(
src/webview/heading-slug.ts:145:export interface LatchedScrollScheduler {
src/webview/heading-slug.ts:161:export function scheduleLatchedScroll(
$ grep -n "function .*ScrollToHeading\|function scrollToHeading" src/webview/main.ts
1605:function scrollToHeading(
1634:function scheduleScrollToHeading(fragment: string): void {
```

---

## 2. Chi tiết thực hiện Issue #170

### 2.1. Tách `#fragment` trước khi resolve file trong `src/host/openWikiLink.ts`

`splitWikiTarget(raw)` tách ở dấu `#` đầu tiên trước khi tìm file hoặc đề nghị tạo file. Nhờ đó `[[Note#Heading]]`, `[[Note#Heading|alias]]` và `[[Note#^block-id]]` đều tìm `Note.md`; nếu `Note.md` chưa tồn tại thì chỉ hỏi tạo `Note.md`, không bao giờ đề nghị tạo file có `#` trong tên. Nếu đích chỉ có fragment (`[[#Heading]]` → `name === ""`), `openWikiLink` trả về `undefined` ngay mà không tìm hay tạo file.

Lệnh trích xuất (`sed -n '36,69p' src/host/openWikiLink.ts`):

```ts
/** A wiki link target split into the file it names and the fragment after `#`. */
export interface WikiTarget {
  /** The file part, trimmed; `""` for a same-document link such as `[[#Heading]]`. */
  name: string;
  /** Text after the first `#` (`Heading`, `^block-id`), or null when there is none. */
  fragment: string | null;
}

/**
 * Split `Note#Heading` into `{ name: "Note", fragment: "Heading" }`. The FIRST
 * `#` splits, because a filename cannot carry one through this syntax and an
 * Obsidian nested fragment (`Note#A#B`) keeps its own `#` intact for the
 * heading matcher. An empty fragment (`Note#`) is no fragment.
 */
export function splitWikiTarget(raw: string): WikiTarget {
  const trimmed = raw.trim();
  const hashIndex = trimmed.indexOf("#");
  if (hashIndex === -1) return { name: trimmed, fragment: null };
  const fragment = trimmed.slice(hashIndex + 1).trim();
  return {
    name: trimmed.slice(0, hashIndex).trim(),
    fragment: fragment === "" ? null : fragment,
  };
}

export async function openWikiLink(
  rawTarget: string,
  currentDocUri?: vscode.Uri,
): Promise<vscode.Uri | undefined> {
  if (!rawTarget) return undefined;
  // From here on `wikiFilename` is the file part only, so neither the lookup
  // nor the create prompt below can ever see a `#`.
  const { name: wikiFilename, fragment } = splitWikiTarget(rawTarget);
  if (!wikiFilename) return undefined;
```

Lệnh trích xuất phần tạo file và mở kèm fragment (`sed -n '123,153p' src/host/openWikiLink.ts`):

```ts
    const choice = await vscode.window.showWarningMessage(
      `Wiki link: file "${targetRel}" not found. Create it?`,
      "Create",
    );
    if (choice === "Create") {
      const newUri = vscode.Uri.file(targetPath);
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(targetPath)));
      await vscode.workspace.fs.writeFile(newUri, new Uint8Array(0));
      await vscode.commands.executeCommand("vscode.open", newUri);
      return newUri;
    }
    return undefined;
  } else if (results.length === 1) {
    await openWithFragment(results[0], fragment);
    return results[0];
  } else {
    const picks = results.map((uri) => ({
      label: path.basename(uri.fsPath),
      description: vscode.workspace.asRelativePath(uri),
      uri,
    }));
    const chosen = await vscode.window.showQuickPick(picks, {
      placeHolder: `Multiple files match "${wikiFilename}.md"`,
    });
    if (chosen) {
      await openWithFragment(chosen.uri, fragment);
      return chosen.uri;
    }
    return undefined;
  }
}
```

### 2.2. Cuộn tại chỗ khi click `[[#Heading]]` cùng file trong `src/webview/main.ts`

Khi `data-filename` của `.wiki-link` bắt đầu bằng `#`, webview gọi thẳng `scrollToHeading(trimmed.slice(1))` trong tài liệu hiện tại và không gửi `openWikiLink` lên host.

Lệnh trích xuất (`sed -n '1550,1582p' src/webview/main.ts`):

```ts
  document.addEventListener("click", (e) => {
    const wikiLink = (e.target as HTMLElement).closest<HTMLElement>(".wiki-link");
    if (wikiLink) {
      e.preventDefault();
      e.stopPropagation();
      const filename = wikiLink.getAttribute("data-filename");
      if (filename) {
        // `[[#Heading]]` is all fragment: it names THIS document, so scroll
        // here and open nothing (#170). Anything with a file part goes to the
        // host, which splits the fragment off before resolving.
        const trimmed = filename.trim();
        if (trimmed.startsWith("#")) {
          scrollToHeading(trimmed.slice(1));
        } else {
          vscode.postMessage({ type: "openWikiLink", filename });
        }
      }
      return;
    }

    const anchor = (e.target as HTMLElement).closest<HTMLAnchorElement>("a[href]");
    if (!anchor || !editor) return;

    e.preventDefault();
    e.stopPropagation();

    const href = anchor.getAttribute("href") || "";
    if (href.startsWith("#")) {
      scrollToHeading(href.slice(1));
    } else {
      vscode.postMessage({ type: "openLink", href });
    }
  });
```

### 2.3. Fixture roundtrip `harness/fixtures/synthetic/wiki-link-fragment.md`

Tokenizer và `renderMarkdown` của `WikiLink` (`src/webview/wiki-link-plugin.ts`) được giữ nguyên để bảo toàn nguyên văn `[[Note#Heading]]`, `[[Note#Heading|alias]]`, `[[Note#^abc]]` khi roundtrip.

Lệnh trích xuất (`sed -n '1,9p' harness/fixtures/synthetic/wiki-link-fragment.md`):

```markdown
A link to a heading in another note: [[Note#Heading]].

The same link with an alias: [[Note#Heading|alias]].

A block reference: [[Note#^abc]].

- In a list, a heading with spaces: [[My Note#My Heading]]
- In a list, a heading in this note: [[#Heading]]
```

---

## 3. Chi tiết thực hiện Issue #171

### 3.1. Quy tắc so khớp fragment duy nhất qua `headingSlug()` trong `src/webview/heading-slug.ts`

`fragmentMatchesHeading(fragment, headingText)` giải mã percent-encoding (nếu hợp lệ), lấy phần sau dấu `#` cuối cùng (hỗ trợ nested fragment `Note#A#B`), từ chối block reference bắt đầu bằng `^`, rồi đưa cả `fragment` lẫn `headingText` qua hàm `headingSlug()` duy nhất. Vì `headingSlug(headingSlug(text)) === headingSlug(text)`, một phép so sánh duy nhất phủ được cả fragment kiểu Obsidian (`#My Heading`) lẫn fragment kiểu Markdown (`#my-heading`).

Lệnh trích xuất (`sed -n '16,51p' src/webview/heading-slug.ts`):

```ts
export function headingSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s/g, "-");
}

/**
 * Whether a link fragment names the heading whose text is `headingText`.
 *
 * BOTH sides go through `headingSlug`, and that is the whole trick (#170,
 * #171): an Obsidian fragment is the heading's TEXT (`[[Note#My Heading]]`), a
 * markdown fragment is its SLUG (`[x](note.md#my-heading)`), and the slug of a
 * slug is the slug, so one comparison covers both without guessing which kind
 * arrived. Around that:
 * - a percent-encoded fragment (`#my%20heading`) is decoded first, falling back
 *   to the raw string when it is not valid percent-encoding;
 * - an Obsidian nested fragment (`A#B`) names its LAST part, the deepest heading;
 * - a block reference (`^block-id`) never names a heading, even one whose text
 *   happens to slug to `block-id`;
 * - a fragment that slugs to nothing (`#!!!`) matches nothing, rather than the
 *   first heading that also slugs to nothing.
 */
export function fragmentMatchesHeading(fragment: string, headingText: string): boolean {
  let decoded = fragment;
  try {
    decoded = decodeURIComponent(fragment);
  } catch {
    /* not percent-encoded: compare the raw text */
  }
  const last = decoded.split("#").pop() ?? "";
  if (last.trim().startsWith("^")) return false;
  const wanted = headingSlug(last.trim());
  if (wanted === "") return false;
  return headingSlug(headingText) === wanted;
}
```

### 3.2. Tìm vị trí heading, cuộn khung nhìn dưới `guardTransaction`, và cặp chốt `scheduleLatchedScroll` trong `src/webview/heading-slug.ts`

- `findHeadingOffset(doc, fragment)` trả về vị trí của heading đầu tiên khớp `fragment`.
- `scrollEditorToHeading(editor, fragment, options)` bọc `editor.commands.setTextSelection(target + 1)` trong `guardTransaction` (tức `contentSync.guardExtensionUpdate` ở `main.ts`) để transaction đặt caret không bao giờ làm tài liệu đích bị dirty (`ContentSync` không gửi `edit`).
- `scheduleLatchedScroll(callback, scheduler)` cài cặp chốt `requestAnimationFrame(once)` + `setTimeout(once, 50)` (#112/#171) để đảm bảo việc cuộn vẫn chạy đúng một lần ngay cả khi cửa sổ bị che khuất khiến Chromium đình chỉ `requestAnimationFrame`.

Lệnh trích xuất (`sed -n '67,203p' src/webview/heading-slug.ts`):

```ts
export function findHeadingOffset(doc: HeadingSearchDoc, fragment: string): number {
  let target = -1;
  doc.descendants((node, pos) => {
    // Returning false from `descendants` only skips the current node's
    // children, not its siblings; the `target !== -1` check is what makes the
    // first matching heading win.
    if (target !== -1) return false;
    if (node.type.name !== "heading") return;
    if (fragmentMatchesHeading(fragment, node.textContent)) target = pos;
    return false;
  });
  return target;
}

export interface ScrollableHeadingEditor {
  state: { doc: HeadingSearchDoc };
  commands: { setTextSelection(position: number): boolean };
  view: { nodeDOM(pos: number): unknown };
}

export interface ScrollEditorToHeadingOptions {
  behavior?: ScrollBehavior;
  /** Whether to move the caret into the matched heading (default: true). */
  select?: boolean;
  /**
   * Optional wrapper around the selection transaction (in `main.ts`,
   * `contentSync.guardExtensionUpdate`) so a programmatic jump never looks like
   * a user edit to `ContentSync`.
   */
  guardTransaction?: <T>(fn: () => T) => T;
  /** Explicit scroll container; defaults to `#editor-container` in the DOM. */
  scroller?: HTMLElement | null;
}

/**
 * Locate the first heading matching `fragment`, place the caret at its start
 * (`pos + 1`) under `guardTransaction`, and scroll `#editor-container` so the
 * heading sits near the top of the viewport. Returns whether a heading matched.
 */
export function scrollEditorToHeading(
  editor: ScrollableHeadingEditor,
  fragment: string,
  options: ScrollEditorToHeadingOptions = {},
): boolean {
  const target = findHeadingOffset(editor.state.doc, fragment);
  if (target === -1) return false;

  const { behavior = "smooth", select = true, guardTransaction } = options;
  if (select) {
    const applySelection = () => editor.commands.setTextSelection(target + 1);
    if (guardTransaction) {
      guardTransaction(applySelection);
    } else {
      applySelection();
    }
  }

  const dom = editor.view.nodeDOM(target);
  if (dom && typeof (dom as HTMLElement).getBoundingClientRect === "function") {
    const el = dom as HTMLElement;
    const scroller =
      options.scroller !== undefined
        ? options.scroller
        : typeof document !== "undefined"
        ? document.getElementById("editor-container")
        : null;
    if (scroller) {
      const elRect = el.getBoundingClientRect();
      const scrollerRect = scroller.getBoundingClientRect();
      const targetTop = elRect.top - scrollerRect.top + scroller.scrollTop - 60;
      scroller.scrollTo({ top: Math.max(0, targetTop), behavior });
    } else if (typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ behavior, block: "start" });
    }
  }
  return true;
}

export interface LatchedScrollScheduler {
  requestAnimationFrame?: (cb: () => void) => any;
  cancelAnimationFrame?: (id: any) => void;
  setTimeout?: (cb: () => void, ms: number) => any;
  clearTimeout?: (id: any) => void;
}

/**
 * Schedule a load-time or host-triggered scroll with the latched
 * `requestAnimationFrame(once)` + `setTimeout(once, 50)` pair (#112, #171).
 *
 * Chromium does not run `requestAnimationFrame` callbacks while a window is
 * covered or hidden. The 50 ms timer guarantees the scroll still runs once when
 * the window is covered, while a visible window runs on the next frame and
 * cancels the timer. Returns a cancel function that disarms both.
 */
export function scheduleLatchedScroll(
  callback: () => void,
  scheduler?: LatchedScrollScheduler,
): () => void {
  let fired = false;
  let rafId: any = null;
  let timerId: any = null;

  const raf = scheduler?.requestAnimationFrame
    ? (cb: () => void) => scheduler.requestAnimationFrame!(cb)
    : typeof requestAnimationFrame === "function"
    ? (cb: () => void) => requestAnimationFrame(cb)
    : (cb: () => void) => setTimeout(cb, 16);
  const caf = scheduler?.cancelAnimationFrame
    ? (id: any) => scheduler.cancelAnimationFrame!(id)
    : typeof cancelAnimationFrame === "function"
    ? (id: any) => cancelAnimationFrame(id)
    : (id: any) => clearTimeout(id);
  const setT = scheduler?.setTimeout
    ? (cb: () => void, ms: number) => scheduler.setTimeout!(cb, ms)
    : (cb: () => void, ms: number) => setTimeout(cb, ms);
  const clearT = scheduler?.clearTimeout
    ? (id: any) => scheduler.clearTimeout!(id)
    : (id: any) => clearTimeout(id);

  const once = () => {
    if (fired) return;
    fired = true;
    if (rafId !== null) caf(rafId);
    if (timerId !== null) clearT(timerId);
    callback();
  };

  rafId = raf(once);
  timerId = setT(once, 50);

  return () => {
    if (fired) return;
    fired = true;
    if (rafId !== null) caf(rafId);
    if (timerId !== null) clearT(timerId);
  };
}
```

### 3.3. Điều phối mở file kèm fragment phía host (`src/host/fragmentNavigation.ts`, `src/host/openLocalFile.ts`, `src/host/messageHandlers.ts`, `src/markdownEditorProvider.ts`, `src/shared/messages.ts`)

`src/host/fragmentNavigation.ts` xử lý cả 3 trạng thái của tài liệu đích khi đi theo `[[Note#Heading]]` hoặc `[text](other.md#heading)`:
1. **Đích chưa mở trong custom editor (`existing.length === 0`):** lưu `fragment` vào `pendingByDoc` theo `fragmentDocKey(uri)` trước khi gọi `vscode.open`. Khi webview đích khởi tạo xong và gửi `ready`, handler `ready` trong `src/host/messageHandlers.ts` gọi `takePendingFragment(ctx.document.uri)` và gửi `{ type: "scrollTo", fragment }` (tiêu thụ đúng một lần).
2. **Đích đã mở trong custom editor (`existing.length > 0`):** `vscode.open` đưa panel hiện có lên trước; vì webview đã sống không gửi lại `ready`, `openWithFragment` gửi thẳng `{ type: "scrollTo", fragment }` tới panel đang mở (ưu tiên `active`, rồi `visible`, rồi phần tử đầu).
3. **Đích mở bằng standard text editor (điểm cộng trong TASK.md — đã thực hiện):** nếu người dùng cấu hình mở `.md` bằng text editor mặc định, sau khi `vscode.open` hoàn tất, `vscode.window.activeTextEditor` giữ tài liệu đích; `revealInActiveTextEditor` dùng `findHeadingLine` (hỗ trợ cả ATX `#` và Setext `===`/`---`, bỏ qua khối code fence) để đặt selection và gọi `editor.revealRange(range, AtTop)`, đồng thời xóa fragment khỏi `pendingByDoc`.

Lệnh trích xuất (`sed -n '108,194p' src/host/fragmentNavigation.ts`):

```ts
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
```

Lệnh trích xuất `src/host/openLocalFile.ts` (`sed -n '20,49p' src/host/openLocalFile.ts`):

```ts
export function openLocalFileInEditor(
  relativePath: string,
  document: vscode.TextDocument,
): Promise<void> {
  const docDir = path.dirname(document.uri.fsPath);
  // Separate file path and anchor fragment
  const hashIndex = relativePath.indexOf("#");
  const filePart = hashIndex !== -1 ? relativePath.slice(0, hashIndex) : relativePath;
  const anchor = hashIndex !== -1 ? relativePath.slice(hashIndex + 1).trim() : "";
  const targetPath = filePart
    ? path.resolve(docDir, filePart)
    : document.uri.fsPath;

  // Security: Validate target is within workspace or document directory
  const wsFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  const allowedRoot = wsFolder?.uri.fsPath || docDir;
  if (!targetPath.startsWith(allowedRoot + path.sep) && targetPath !== allowedRoot) {
    vscode.window.showWarningMessage(`Cannot open file outside workspace: ${filePart}`);
    return Promise.resolve();
  }

  const targetUri = vscode.Uri.file(targetPath);
  const fragment = anchor !== "" && isMarkdownPath(targetPath) ? anchor : null;
  return openWithFragment(targetUri, fragment).then(
    undefined,
    () => {
      vscode.window.showWarningMessage(`Cannot open file: ${relativePath}`);
    },
  );
}
```

Lệnh trích xuất `src/host/messageHandlers.ts` (`sed -n '68,78p' src/host/messageHandlers.ts`):

```ts
  ready: (_msg, ctx) => {
    sendSavedPreferences(ctx.webview, ctx.globalState);
    ctx.session.sendTheme();
    ctx.session.sendConfig();
    ctx.session.updateWebview();
    // A link with a `#fragment` opened this document (#171). Posted now, ahead
    // of the debounced `update`; the webview holds it until content is in.
    const fragment = takePendingFragment(ctx.document.uri);
    if (fragment) {
      ctx.webview.postMessage({ type: "scrollTo", fragment });
    }
```

Lệnh trích xuất `src/markdownEditorProvider.ts` (`sed -n '145,149p' src/markdownEditorProvider.ts`):

```ts
    // Where a followed `other.md#heading` link can reach this panel (#171).
    session.disposables.push(
      registerScrollTarget(document.uri, webviewPanel, session.webview),
    );

```

Lệnh trích xuất `src/shared/messages.ts` (`sed -n '235,257p' src/shared/messages.ts`):

```ts
export interface ScrollToMessage {
  type: "scrollTo";
  fragment: string;
}


export type HostToWebviewMessage =
  | UpdateMessage
  | ThemeMessage
  | ConfigMessage
  | SavedThemeMessage
  | SavedFontMessage
  | SavedZoomMessage
  | SystemFontsMessage
  | ImageSavedMessage
  | ClipboardImageMessage
  | ImageUrlEditResponseMessage
  | ImageRenameResponseMessage
  | FileSearchResultsMessage
  | WikiLinkSearchResultsMessage
  | ExportDoneMessage
  | BacklinksMessage
  | ScrollToMessage;
```

### 3.4. Nhận `scrollTo`, xử lý đua thứ tự với `update` đầu tiên, và bù dịch chuyển layout do Mermaid/ảnh trong `src/webview/main.ts`

- Khi mở tài liệu mới, `ready` gửi `scrollTo` ngay lập tức trong khi `session.updateWebview()` được debounce 50ms phía host. Do đó `scrollTo` đến trước khi `editor` được tạo; webview giữ fragment trong `pendingScrollFragment` và chỉ gọi `scheduleScrollToHeading(fragment)` ở cuối `case "update"` sau khi `initEditor`, `transformTableCellsAfterParse`, transaction dàn xếp `trailingNode`, và `resetContentBaseline()` đã hoàn tất.
- Khi tài liệu đã mở sẵn, `editor` đã tồn tại nên `case "scrollTo"` gọi ngay `scheduleScrollToHeading(message.fragment)`.
- **Xử lý dịch chuyển layout do Mermaid/ảnh:** `scheduleScrollToHeading` chạy lần cuộn đầu qua `scheduleLatchedScroll` với `behavior: "instant"` (không phụ thuộc chuỗi animation frame) và `select: true`. Sau đó, nó gắn một `ResizeObserver` ngắn hạn (tối đa 2000ms) lên `.tiptap`: mỗi khi `.tiptap` thay đổi `offsetHeight` (do sơ đồ Mermaid debounce 500ms + render bất đồng bộ hoặc ảnh phía trên heading đích tải xong), nó gọi lại `scrollToHeading(fragment, "instant", false)` để giữ heading đích ở đỉnh khung nhìn mà không ghi đè lại selection. Ngay khi người dùng tương tác (`wheel`, `mousedown`, `keydown`, `touchstart`) hoặc hết cửa sổ 2000ms, `ResizeObserver` tự ngắt kết nối.

Lệnh trích xuất (`sed -n '1592,1675p' src/webview/main.ts`):

```ts
let pendingScrollFragment: string | null = null;
let cancelScheduledScroll: (() => void) | null = null;

/**
 * Scroll the editor to the first heading a link fragment names, and put the
 * caret in it. Returns whether a heading matched.
 *
 * `fragment` is whatever followed the `#`: a slug from a markdown link
 * (`#my-heading`) or heading text from a wiki link (`[[#My Heading]]`);
 * `scrollEditorToHeading` compares both through the one slug rule in
 * `heading-slug.ts` and runs `setTextSelection` inside
 * `contentSync.guardExtensionUpdate` so jumping never dirties the document.
 */
function scrollToHeading(
  fragment: string,
  behavior: ScrollBehavior = "smooth",
  select = true,
): boolean {
  if (!editor) return false;
  return scrollEditorToHeading(editor, fragment, {
    behavior,
    select,
    guardTransaction: (fn) => contentSync.guardExtensionUpdate(fn),
  });
}

/**
 * Schedule a host-driven `scrollTo` jump (#171).
 *
 * Two hazards at document open:
 * 1. A covered or background window never receives `requestAnimationFrame`
 *    callbacks in Chromium (#112), so the initial jump uses the latched
 *    `requestAnimationFrame(once)` + `setTimeout(once, 50)` pair via
 *    `scheduleLatchedScroll` and scrolls with `"instant"` behavior (which does
 *    not depend on animation frames to advance).
 * 2. Mermaid diagrams (500 ms debounce + async lazy artifact render) and images
 *    above the target heading grow `.tiptap` asynchronously after the initial
 *    scroll, pushing the heading down. A short-lived `ResizeObserver` on
 *    `.tiptap` re-aligns `#editor-container` whenever `.tiptap` changes height
 *    during the initial 2000 ms settle window, and disconnects immediately on
 *    any user input (`wheel`, `mousedown`, `keydown`, `touchstart`).
 */
function scheduleScrollToHeading(fragment: string): void {
  cancelScheduledScroll?.();
  cancelScheduledScroll = null;

  let stopObserver: (() => void) | null = null;
  const cancelLatch = scheduleLatchedScroll(() => {
    if (!scrollToHeading(fragment, "instant", true)) return;
    if (typeof ResizeObserver === "undefined") return;
    const tiptapEl = document.querySelector(".tiptap") as HTMLElement | null;
    if (!tiptapEl) return;

    let lastHeight = tiptapEl.offsetHeight;
    const observer = new ResizeObserver(() => {
      const nextHeight = tiptapEl.offsetHeight;
      if (nextHeight === lastHeight) return;
      lastHeight = nextHeight;
      scrollToHeading(fragment, "instant", false);
    });
    observer.observe(tiptapEl);

    const stopEvents = ["wheel", "mousedown", "keydown", "touchstart"] as const;
    const settleTimer = setTimeout(() => cleanup(), 2000);
    const cleanup = () => {
      if (!stopObserver) return;
      stopObserver = null;
      clearTimeout(settleTimer);
      observer.disconnect();
      for (const evt of stopEvents) {
        window.removeEventListener(evt, cleanup);
      }
    };
    stopObserver = cleanup;
    for (const evt of stopEvents) {
      window.addEventListener(evt, cleanup, { passive: true });
    }
  });

  cancelScheduledScroll = () => {
    cancelLatch();
    stopObserver?.();
  };
}
```

Lệnh trích xuất phần tiêu thụ `pendingScrollFragment` trong `case "update"` (`sed -n '1764,1768p' src/webview/main.ts`) và `case "scrollTo"` (`sed -n '1929,1938p' src/webview/main.ts`):

```ts
              if (pendingScrollFragment !== null) {
                const fragment = pendingScrollFragment;
                pendingScrollFragment = null;
                scheduleScrollToHeading(fragment);
              }
```

```ts
    case "scrollTo":
      if (typeof message.fragment === "string" && message.fragment) {
        if (editor) {
          pendingScrollFragment = null;
          scheduleScrollToHeading(message.fragment);
        } else {
          pendingScrollFragment = message.fragment;
        }
      }
      break;
```

---

## 4. Chứng minh có răng (Ràng buộc 9)

Mỗi cơ chế mới đều được phá trực tiếp trên file nguồn mang cơ chế đó, chạy bộ kiểm tra để đếm số ca đỏ, rồi khôi phục nguyên trạng byte-identical và chạy lại xác nhận xanh:

| Phép kiểm | File bị phá | Thay đổi làm sai hàm | Số ca đỏ | Khôi phục |
| --- | --- | --- | --- | --- |
| Unit test tách fragment & resolve `#170` | `src/host/openWikiLink.ts` | Không cắt phần trước `#` trong `splitWikiTarget` (`name: trimmed`) | **14 ca đỏ** (`fail 14`, `pass 123`) | `fail 0`, `pass 137` |
| Fixture roundtrip `wiki-link-fragment.md` `#170` | `src/webview/wiki-link-plugin.ts` | Cắt mất `#fragment` khi serialize `renderMarkdown` | **1 fixture đỏ** (`FAIL synthetic/wiki-link-fragment.md`) | `67 passed, 0 failed` |
| Unit test so khớp slug/text `fragmentMatchesHeading` `#170/#171` | `src/webview/heading-slug.ts` | Bỏ `headingSlug()` phía fragment (`const wanted = last.trim()`) | **9 ca đỏ** (`fail 9`, `pass 128`) | `fail 0`, `pass 137` |
| Unit test điều phối fragment phía host `openWithFragment` `#171` | `src/host/fragmentNavigation.ts` | Bỏ qua nhánh xử lý fragment (`if (true)`) | **4 ca đỏ** (`fail 4`, `pass 133`) | `fail 0`, `pass 137` |
| Unit test truyền `#anchor` từ markdown link `openLocalFileInEditor` `#171` | `src/host/openLocalFile.ts` | Luôn truyền `fragment = null` | **2 ca đỏ** (`fail 2`, `pass 135`) | `fail 0`, `pass 137` |
| Unit test cuộn heading & giữ sạch `ContentSync` `#171` | `src/webview/heading-slug.ts` | `scrollEditorToHeading` trả `false` | **1 ca đỏ** (`fail 1`, `pass 136`) | `fail 0`, `pass 137` |
| Unit test cặp chốt `scheduleLatchedScroll` `#171` | `src/webview/heading-slug.ts` | Bỏ `setTimeout(once, 50)` dự phòng khi cửa sổ bị che | **2 ca đỏ** (`fail 2`, `pass 135`) | `fail 0`, `pass 137` |

### 4.1. Log phá `splitWikiTarget` trong `src/host/openWikiLink.ts` (14 ca đỏ)

```text
$ sed -i 's|    name: trimmed.slice(0, hashIndex).trim(),|    name: trimmed,|' src/host/openWikiLink.ts
$ git diff -U0 -- src/host/openWikiLink.ts   (break, relative to the working tree before the break)
@@ -56 +56 @@
-    name: trimmed.slice(0, hashIndex).trim(),
+    name: trimmed,
$ npm test   (broken)
✖ already-open target: openWikiLink and openLocalFileInEditor post scrollTo directly to the open panel (5.583708ms)
✖ a missing target offers to create Note.md, never Note#Heading.md (4.841252ms)
✖ a note found only by the workspace scan still resolves without the fragment (3.83176ms)
✖ a target that is all fragment has an empty file part (0.573302ms)
✖ cross-file fragment navigation on the host (#171) (35.807999ms)
✖ [[#Heading]] names the current document: no lookup, no prompt, no open (2.868249ms)
ℹ fail 14
ℹ pass 123
ℹ tests 137
✖ keeps spaces inside the heading text and trims around the # (0.557621ms)
✖ no # means no fragment, and an empty fragment is none (0.499626ms)
✖ [[Note#^abc]] opens Note.md and prompts for nothing (3.22974ms)
✖ [[Note#Heading|alias]] opens Note.md and prompts for nothing (3.388467ms)
✖ [[Note#Heading]] opens Note.md and prompts for nothing (23.259341ms)
✖ openWikiLink with a fragment (#170) (42.236105ms)
✖ splits a block reference off the file part (0.58355ms)
✖ splits a heading fragment off the file part (3.184402ms)
✖ splits at the FIRST #, so a nested fragment stays whole (0.45744ms)
✖ splitWikiTarget (#170) (6.661699ms)
✖ unopened target: openWikiLink queues the fragment and target's ready posts scrollTo once (25.643934ms)
$ restore; npm test   (restored)
ℹ fail 0
ℹ pass 137
ℹ tests 137
$ cmp restored file
restored byte-identical
```

### 4.2. Log phá `renderMarkdown` trong `src/webview/wiki-link-plugin.ts` (1 fixture đỏ)

```text
$ sed -i 's@return `\[\[${filename}|${alias}]]`;@return `[[${filename.split("#")[0]}|${alias}]]`;@; s@return `\[\[${filename}]]`;@return `[[${filename.split("#")[0]}]]`;@' src/webview/wiki-link-plugin.ts
$ git diff -U0 -- src/webview/wiki-link-plugin.ts   (break, relative to the working tree before the break)
@@ -255,2 +255,2 @@
-    if (alias) return `[[${filename}|${alias}]]`;
-    return `[[${filename}]]`;
+    if (alias) return `[[${filename.split("#")[0]}|${alias}]]`;
+    return `[[${filename.split("#")[0]}]]`;
$ npm roundtrip   (broken)
FAIL     synthetic/wiki-link-fragment.md (+5 -5 lines)
46 markdown fixtures + 21 seams: 66 passed, 1 failed, 0 missing, 0 errored
$ restore; npm roundtrip   (restored)
46 markdown fixtures + 21 seams: 67 passed, 0 failed, 0 missing, 0 errored
$ cmp restored file
restored byte-identical
```

### 4.3. Log phá `fragmentMatchesHeading` trong `src/webview/heading-slug.ts` (9 ca đỏ)

```text
$ sed -i 's|  const wanted = headingSlug(last.trim());|  const wanted = last.trim();|' src/webview/heading-slug.ts
$ git diff -U0 -- src/webview/heading-slug.ts   (break, relative to the working tree before the break)
@@ -48 +48 @@
-  const wanted = headingSlug(last.trim());
+  const wanted = last.trim();
$ npm test   (broken)
✖ "100%" vs heading "100%" -> true (invalid percent-encoding falls back to the raw text) (0.600955ms)
✖ findHeadingLine for text editor fallback (#171) (1.234141ms)
✖ finds the first matching heading, scrolls #editor-container, and keeps ContentSync clean (0 edits) (1011.763292ms)
✖ fragmentMatchesHeading (#170, #171) (12.098126ms)
ℹ fail 9
✖ ignores headings inside fenced code blocks and matches ATX and Setext headings (1.053273ms)
ℹ pass 128
ℹ tests 137
✖ "my%20heading" vs heading "My Heading" -> true (percent-encoded text) (0.367444ms)
✖ "My Heading" vs heading "My Heading" -> true (Obsidian: heading text) (3.421049ms)
✖ "Parent#Child" vs heading "Child" -> true (nested fragment names its last part) (0.408893ms)
✖ the slug of a slug is the slug, which is why one comparison covers both kinds (0.394093ms)
✖ "Tiếng Việt" vs heading "Tiếng Việt" -> true (Unicode text) (0.719268ms)
✖ webview scrollEditorToHeading, ContentSync clean-state, and latched scheduler (#171) (1012.641913ms)
✖ "What's new?" vs heading "What's new?" -> true (text with punctuation) (0.343573ms)
$ restore; npm test   (restored)
ℹ fail 0
ℹ pass 137
ℹ tests 137
$ cmp restored file
restored byte-identical
```

### 4.4. Log phá `openWithFragment` trong `src/host/fragmentNavigation.ts` (4 ca đỏ)

```text
$ sed -i 's|if (!fragment) {|if (true) {|' src/host/fragmentNavigation.ts
$ git diff -U0 -- src/host/fragmentNavigation.ts   (break, relative to the working tree before the break)
@@ -160 +160 @@
-  if (!fragment) {
+  if (true) {
$ npm test   (broken)
✖ already-open target: openWikiLink and openLocalFileInEditor post scrollTo directly to the open panel (20.578021ms)
✖ cross-file fragment navigation on the host (#171) (61.017378ms)
ℹ fail 4
ℹ pass 133
ℹ tests 137
✖ text-editor fallback: reveals the matching heading line when opened in activeTextEditor (1.253427ms)
✖ unopened target: openLocalFileInEditor queues markdown #anchor and ignores image #anchor (2.830065ms)
✖ unopened target: openWikiLink queues the fragment and target's ready posts scrollTo once (35.944278ms)
$ restore; npm test   (restored)
ℹ fail 0
ℹ pass 137
ℹ tests 137
$ cmp restored file
restored byte-identical
```

### 4.5. Log phá `openLocalFileInEditor` trong `src/host/openLocalFile.ts` (2 ca đỏ)

```text
$ sed -i 's|const fragment = anchor !== "" && isMarkdownPath(targetPath) ? anchor : null;|const fragment = null;|' src/host/openLocalFile.ts
$ git diff -U0 -- src/host/openLocalFile.ts   (break, relative to the working tree before the break)
@@ -42 +42 @@
-  const fragment = anchor !== "" && isMarkdownPath(targetPath) ? anchor : null;
+  const fragment = null;
$ npm test   (broken)
✖ already-open target: openWikiLink and openLocalFileInEditor post scrollTo directly to the open panel (5.072239ms)
✖ cross-file fragment navigation on the host (#171) (40.533261ms)
ℹ fail 2
ℹ pass 135
ℹ tests 137
✖ unopened target: openLocalFileInEditor queues markdown #anchor and ignores image #anchor (2.748697ms)
$ restore; npm test   (restored)
ℹ fail 0
ℹ pass 137
ℹ tests 137
$ cmp restored file
restored byte-identical
```

### 4.6. Log phá `scrollEditorToHeading` trong `src/webview/heading-slug.ts` (1 ca đỏ)

```text
$ sed -i 's|if (target === -1) return false;|return false;|' src/webview/heading-slug.ts
$ git diff -U0 -- src/webview/heading-slug.ts   (break, relative to the working tree before the break)
@@ -112 +112 @@
-  if (target === -1) return false;
+  return false;
$ npm test   (broken)
✖ finds the first matching heading, scrolls #editor-container, and keeps ContentSync clean (0 edits) (1053.187421ms)
ℹ fail 1
ℹ pass 136
ℹ tests 137
✖ webview scrollEditorToHeading, ContentSync clean-state, and latched scheduler (#171) (1054.1478ms)
$ restore; npm test   (restored)
ℹ fail 0
ℹ pass 137
ℹ tests 137
$ cmp restored file
restored byte-identical
```

### 4.7. Log phá `scheduleLatchedScroll` trong `src/webview/heading-slug.ts` (2 ca đỏ)

```text
$ sed -i 's|timerId = setT(once, 50);|// no timer fallback|' src/webview/heading-slug.ts
$ git diff -U0 -- src/webview/heading-slug.ts   (break, relative to the working tree before the break)
@@ -195 +195 @@
-  timerId = setT(once, 50);
+  // no timer fallback
$ npm test   (broken)
ℹ fail 2
ℹ pass 135
ℹ tests 137
✖ scheduleLatchedScroll fires via 50ms timer when requestAnimationFrame is stalled in a covered window (1.457009ms)
✖ scheduleLatchedScroll runs on rAF when visible and cancels the 50ms timer (0.402739ms)
✖ webview scrollEditorToHeading, ContentSync clean-state, and latched scheduler (#171) (1027.315879ms)
$ restore; npm test   (restored)
ℹ fail 0
ℹ pass 137
ℹ tests 137
$ cmp restored file
restored byte-identical
```

---

## 5. Các tiêu chí trong issue chưa kiểm tự động được và lý do

1. **Cuộn liên-panel đầu-cuối (end-to-end) trong VS Code thật khi click `[[Note#Heading]]` / `[text](other.md#heading)`:**
   - **Lý do:** Ràng buộc 8 trong `.wave11-spec/COMMON.md` cấm worker sửa `harness/vscode-floor/extension-tests.ts` và `harness/vscode-floor/run.mjs`.
   - **Phạm vi đã kiểm thay thế:** Các chặng cấu thành đã được kiểm bằng unit test trong `test/heading-fragment.test.ts` (luồng host `openWikiLink` / `openLocalFileInEditor` → `openWithFragment` → `dispatchMessage("ready")` / `registerScrollTarget` / `revealRange`; luồng webview `scrollEditorToHeading` trên instance Tiptap `Editor` thật với JSDOM + `ContentSync` xác nhận 0 `edit` được gửi; và `scheduleLatchedScroll` khi `requestAnimationFrame` bị treo). Đặc tả đầy đủ cho bài kiểm tra floor được viết ở Mục 8 bên dưới để điều phối viên thêm sau khi merge.
2. **Bù dịch chuyển layout bằng `ResizeObserver` trong `scheduleScrollToHeading` khi Mermaid/ảnh phía trên heading đích tải xong:**
   - **Lý do:** JSDOM không tính toán layout hình học (`offsetHeight` luôn bằng `0`) và không kích hoạt `ResizeObserver` khi SVG/ảnh giãn chiều cao. Cơ chế này cần được kiểm trên Chromium thật trong VS Code floor check (Mục 8).
3. **Đích là block reference `[[Note#^block-id]]`:**
   - Ở #170, `splitWikiTarget` đã tách `^block-id` khỏi tên file để mở đúng `Note.md`, và `fragmentMatchesHeading` chủ động trả về `false` cho mọi fragment bắt đầu bằng `^` để không khớp nhầm vào một heading có chữ trùng với `block-id`. Editor hiện không có node/attr cho block ID kiểu Obsidian ở cấp đoạn văn nên khi mở `Note.md` qua `[[Note#^block-id]]`, tài liệu mở ở vị trí mặc định mà không cuộn tới đoạn văn.

---

## 6. Kết quả chạy bộ kiểm tra trước khi `DONE:`

### 6.1. `lint`, `build`, `test`, `roundtrip`, vòng hai và kiểm tra `harness/fixtures/synthetic/`

```text
=== npm run lint ===
npm warn Unknown user config "allow-remote". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

> tui-milkdown-vscode@3.4.2 lint
> tsc --noEmit

=== npm run build ===
npm warn Unknown user config "allow-remote". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

> tui-milkdown-vscode@3.4.2 build
> node esbuild.config.js

Building (production)...
Build complete (production)
webview bundle: 1030631 B / 1100000 B budget
=== npm test ===
npm warn Unknown user config "allow-remote". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.
▲ [WARNING] Import "Selection" will always be undefined because there is no matching export in "test/vscode-stub.ts" [import-is-undefined]

    src/host/fragmentNavigation.ts:140:22:
      140 │     if (typeof vscode.Selection === "function") {
          ╵                       ~~~~~~~~~

▲ [WARNING] Import "Selection" will always be undefined because there is no matching export in "test/vscode-stub.ts" [import-is-undefined]

    src/host/fragmentNavigation.ts:140:22:
      140 │     if (typeof vscode.Selection === "function") {
          ╵                       ~~~~~~~~~

▲ [WARNING] Import "TextEditorRevealType" will always be undefined because there is no matching export in "test/vscode-stub.ts" [import-is-undefined]

    src/host/fragmentNavigation.ts:143:25:
      143 │     const atTop = vscode.TextEditorRevealType?.AtTop ?? 3;
          ╵                          ~~~~~~~~~~~~~~~~~~~~

▲ [WARNING] Import "TextEditorRevealType" will always be undefined because there is no matching export in "test/vscode-stub.ts" [import-is-undefined]

    src/host/fragmentNavigation.ts:143:25:
      143 │     const atTop = vscode.TextEditorRevealType?.AtTop ?? 3;
          ╵                          ~~~~~~~~~~~~~~~~~~~~

▲ [WARNING] Import "Selection" will always be undefined because there is no matching export in "test/vscode-stub.ts" [import-is-undefined]

    src/host/fragmentNavigation.ts:140:22:
      140 │     if (typeof vscode.Selection === "function") {
          ╵                       ~~~~~~~~~

▲ [WARNING] Import "TextEditorRevealType" will always be undefined because there is no matching export in "test/vscode-stub.ts" [import-is-undefined]

    src/host/fragmentNavigation.ts:143:25:
      143 │     const atTop = vscode.TextEditorRevealType?.AtTop ?? 3;
          ╵                          ~~~~~~~~~~~~~~~~~~~~

▲ [WARNING] Import "env" will always be undefined because there is no matching export in "test/vscode-stub.ts" [import-is-undefined]

    src/host/messageHandlers.ts:190:13:
      190 │       vscode.env.openExternal(vscode.Uri.parse(linkHref));
          ╵              ~~~

  ✔ [[Note#Heading]] opens Note.md and prompts for nothing (17.730045ms)
  ✔ [[Note#Heading|alias]] opens Note.md and prompts for nothing (2.232069ms)
  ✔ [[Note#^abc]] opens Note.md and prompts for nothing (1.87229ms)
  ✔ a note found only by the workspace scan still resolves without the fragment (2.720962ms)
  ✔ a missing target offers to create Note.md, never Note#Heading.md (4.296046ms)
  ✔ [[#Heading]] names the current document: no lookup, no prompt, no open (0.902801ms)
✔ openWikiLink with a fragment (#170) (30.344674ms)
ℹ tests 137
ℹ suites 34
ℹ pass 137
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1357.059404
=== npm run roundtrip ===
npm warn Unknown user config "allow-remote". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package
corpus: 46 fixtures (41 synthetic, 5 repo docs)

──────────────────────────────────────────
──────────────────────────────────────────
46 markdown fixtures + 21 seams: 67 passed, 0 failed, 0 missing, 0 errored
=== vong hai ===
npm warn Unknown user config "allow-remote". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package
corpus: 46 fixtures (41 synthetic, 5 repo docs)

──────────────────────────────────────────
──────────────────────────────────────────
46 markdown fixtures + 21 seams: 67 passed, 0 failed, 0 missing, 0 errored
=== git status --short harness/ ===
=== merge-base diff harness/fixtures/synthetic/ ===
 harness/fixtures/synthetic/wiki-link-fragment.md | 8 ++++++++
 1 file changed, 8 insertions(+)
```

### 6.2. VS Code floor check (`verify:vscode-floor`)

Lệnh chạy:
`PUPPETEER_EXECUTABLE_PATH=$HOME/.cache/puppeteer-floor/chrome-nosandbox xvfb-run -a -s "-screen 0 1920x1080x24" npm run verify:vscode-floor`

Output thật:

```text
npm warn Unknown user config "allow-remote". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

> tui-milkdown-vscode@3.4.2 verify:vscode-floor
> npm run build && npm run build:floor-tests && node harness/vscode-floor/run.mjs

npm warn Unknown env config "allow-remote". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.
npm warn Unknown user config "allow-remote". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

> tui-milkdown-vscode@3.4.2 build
> node esbuild.config.js

Building (production)...
Build complete (production)
webview bundle: 1030631 B / 1100000 B budget
npm warn Unknown env config "allow-remote". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.
npm warn Unknown user config "allow-remote". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

> tui-milkdown-vscode@3.4.2 build:floor-tests
> node esbuild.harness.config.js --floor-tests

harness built: out/harness/vscode-floor-tests.js
VS Code floor check — target version 1.85.0

PASS  floor VS Code build launched — 2 debug target(s); window skipped (not darwin)
PASS  vscode version is the floor — running 1.85.0, expected 1.85.0
PASS  extension resolves — /home/tuanhv/.paseo/worktrees/3t05p45h/w11-wiki-fragment
PASS  extension activates — isActive=true
PASS  command registered: tuiMarkdown.viewSource
PASS  command registered: tuiMarkdown.viewRichText
PASS  command registered: tuiMarkdown.useAsDefaultEditor
PASS  custom editor opens the document — sample.md (tuiMarkdown.editor)
PASS  opening the document leaves it unmodified — isDirty=false
PASS  custom editor still open after the hold — held 25000ms
PASS  document still unmodified after the hold — isDirty=false
PASS  a keystroke undone inside the debounce window leaves the document clean — isDirty=false version=1; typed and removed "Z" 78ms apart, debounce 300ms
PASS  a typed character reaches the document — isDirty=true sentinelInText=true version 1→15
PASS  clicking a backlink opens the linking document — linksHereTabOpen=true tabs=[sample.md, links-here.md, sample.md]
PASS  opening a <details> does not write ` open` into the document — detailsOpenInText=false detailsTagsInText=2
PASS  double-click rename leaves every reference on the new relative path (#142) — asked=1 shown="media/icon.png" renamedOnDisk=true oldGone=true newRelative=2 oldRelative=0 webviewUrls=0 (two references in sample.md, so two must come out on the new name; a webview address here is the #142 lossy shape, an oldRelative>0 is the second image node serialized from a stale map; the later save may trash a dangling reference)
PASS  the edit does not bounce between host and webview — version 15 then 15 after 3s idle
PASS  view source opens the raw markdown in a text editor — 1 visible text editor(s)
PASS  export produces a real DOCX file — floor-export.docx bytes=32171 magic=504b0304 (expected 504b0304)
PASS  export produces a real PDF file — floor-export.pdf bytes=74257 magic=25504446 (expected 25504446)
PASS  vscode.workspace.fs.delete accepts useTrash in this host — deleted=true threw=no landedIn=nowhere found (HOME=/home/tuanhv, ~/.Trash:Error /System/Volumes/Data/.Trashes:Error /.Trashes:Error) (landedIn is REPORTED, not asserted: compare it with the image check's trashedTo — the same reading from both means the Trash half is VS Code's behaviour as this harness launches it, not this extension's call)
PASS  removing an image from the markdown deletes the file on save — baselined=true loneImageDeleted=true trashedTo=nowhere found (HOME=/home/tuanhv, ~/.Trash:Error /System/Volumes/Data/.Trashes:Error /.Trashes:Error); sharedImageSurvived=true prompts=1 namedOther=true loneAlreadyGoneWhenAsked=true otherWarnings=0 (#126: the shared image must survive a Keep, and the unreferenced one must not queue behind the question. trashedTo is REPORTED: one extension-test host is not evidence about the user's own desktop)
PASS  answering the prompt deletes the shared image after all — prompts=1 sharedImageDeleted=true trashedTo=nowhere found (HOME=/home/tuanhv, ~/.Trash:Error /System/Volumes/Data/.Trashes:Error /.Trashes:Error) (#126: Keep is not the only answer the host can give, and this is the half the Keep check cannot reach)
PASS  an image put back while the prompt is open survives the answer — prompts=1 referencePutBackDuringPrompt=true imageSurvivedTheYes=true (#126: the prompt has no deadline, and the save that puts the image back detects nothing because the baseline was already cleared, so the answer is re-validated against a fresh read of the document)
PASS  a diff of two .md files opens as a diff editor, not this custom editor — noSetting=diff "*.md":"tuiMarkdown.editor"=diff; Git Graph's own diff view is NOT covered here and stays a hand check
PASS  workbench.editorAssociations decides which editor opens .md — noSetting=tuiMarkdown.editor "*.md":"default"=text "*.md":"tuiMarkdown.editor"=tuiMarkdown.editor
PASS  webview mounts the editor — vscode-webview://052s8vt9rl5ae9h6r2p2349, mounted 1744ms into the probe
PASS  document content rendered in the webview — heading="▼Heading One" tableRows=3 bold=true codeBlocks=2 taskItems=2 checkboxes=2 alerts=1
PASS  lazy mermaid artifact loads and renders — rendered=1 errors=0 stuckPlaceholders=0 scheduled=1 visibility=visible; 3122ms after mount, budget 40000ms
PASS  lazy KaTeX artifact loads and renders a formula — katexRendered=2 mathNodes=2 visibility=visible; 0ms after mount, budget 40000ms
PASS  whitelisted HTML renders as real elements — kbd=1 details=1 rawHtmlBadges=0
PASS  toolbar and metadata panel present — toolbar=true metadataPanel=true bodyClass=vscode-dark theme-frame-dark dark-theme
PASS  webview interactions could be driven — typed FLOORPROBE; sentinel present in the editor DOM; clicked #btn-source
PASS  a code block header button click leaves the renderer responsive — control=3ms | .code-wrap-btn=alive after 3ms | .code-lines-btn=alive after 2ms | {"preClass":"code-wrap has-line-numbers","gutters":1}
PASS  the VS Code window is on screen when the surfaces start — visibility=visible reraise=not needed; measured ONCE, here: the front can be taken again later, which is why each drag-handle check reports its own visibility. Red here means every position-dependent check below is measuring the window manager rather than the editor
PASS  table context menu is operable from the keyboard and offers alignment — selectionInCell=true focusInEditor=false openedImmediately=true open=true items=13 alignEntries=3 focusInside=true focus="⬌Select Row" afterArrowDown="⬍Select Column" reachedAlignIn=6steps("←Align Column Left") enterChangedAlign=false ((none)->(none); reported, not asserted: focusInEditor=false means the ProseMirror selection never reached the table) closedOnEscape=true
PASS  slash command opens a filtered block menu — open=true items=18 attachedToEditorContainer=true caretIn=p:"/"
PASS  emoji picker loads its lazy dataset and lists matches — open=true items=20 attachedToEditorContainer=true
PASS  drag handle loads lazily and follows the block under the pointer — present=true attachedToEditorContainer=true hoveredAt=360,273 handleTop=260 dy(vs hovered block)=0 scrolledIntoView=true placed=true styleTop=142.391px position=absolute offsetParent=DIV containerScrollTop=0 visibility=visible underPointer="P:Some bold text and" handleLinesUpWith="P:Some bold text and"
PASS  bubble menu appears on a text selection — present=true visible=true buttons=5 [bold,italic,code,link,highlight] attachedToEditorContainer=true
PASS  link editor opens as a popover at the caret — present=true open=true input=true focusInside=true
PASS  an image with a width is an image node, not a raw-HTML badge — sizedImgCssWidth=96px parent=<p> imgs=4 real=2 [p:icon.png p:(empty) p:icon.png p:(empty)] classes=[(none) ProseMirror-separator (none) ProseMirror-separator] rawHtmlBadges=0 resizeHandles=2
PASS  lightbox takes focus on open and gives it back on Escape — opened=true focusInside=true (BUTTON.lightbox-btn) role=dialog visibility=visible waitedForFocus=0ms; afterEscape closed=true focusLeftOverlay=true (IMG)
PASS  bubble menu still tracks the selection at a non-100% zoom — zoom=120% present=true visible=true attachedToEditorContainer=true selectedTextBelowMenuAt=7 selCenterX=162 menuCenterX=162 dx=0 selTop=292 menuTop=248 dy=44
PASS  @ mention popup lists workspace files — open=true items=3 first="icon.pngmedia" attachedToEditorContainer=true
PASS  [[ wiki link popup lists workspace files — open=true items=2 first="links-here" attachedToEditorContainer=true
PASS  drag handle still tracks its block at a non-100% zoom — zoom=120% present=true attachedToEditorContainer=true blockTop=288 handleTop=289 gapToBlock=19 blockHeight=32 placed=true styleTop=170.869px visibility=visible underPointer="P:Some bold text and" handleLinesUpWith="P:Some bold text and"
PASS  a heading's collapse arrow is clear of the drag handle and takes the click — handleLinesUpWith="H1:▼Heading One" underPointer="H1:▼Heading One" visibility=visible zoom=100% handleVisible=true handle=[38,54] arrowLeft=56 headingLeft=71 overArrow=false hitAtArrow=SPAN.heading-collapse-toggle midY arrow=217 handle=217 line=217 collapsedByPress=true reopenedBySecondPress=true
PASS  a heading's collapse arrow is clear of the drag handle and takes the click at 150% zoom — handleLinesUpWith="H1:▼Heading One" underPointer="H1:▼Heading One" visibility=visible zoom=150% handleVisible=true handle=[47,63] arrowLeft=66 headingLeft=89 overArrow=false hitAtArrow=SPAN.heading-collapse-toggle midY arrow=266.6 handle=266.6 line=266.6 collapsedByPress=true reopenedBySecondPress=true
PASS  the editor fits its container and scrolls to its own end at 100% zoom — zoom=100% leftGap=0 rightGap=0 columnWidth=644 scrollHeight=2455 expectedScrollHeight=2455 clientHeight=624 visibility=visible
PASS  the editor fits its container and scrolls to its own end at 50% zoom — zoom=50% leftGap=2 rightGap=2 columnWidth=640 scrollHeight=1674 expectedScrollHeight=1674 clientHeight=624 visibility=visible
PASS  the editor fits its container and scrolls to its own end at 150% zoom — zoom=150% leftGap=0 rightGap=0 columnWidth=644 scrollHeight=3296 expectedScrollHeight=3296 clientHeight=624 visibility=visible
PASS  a click at 150% zoom puts the caret in the block under the pointer — zoom=150% pointer=360,350 pointedAt="P:Some bold text and" caretIn="P:Some bold text and" collapsed=true caretX=361 caret=[336,364] row=[331,369]
PASS  KaTeX fonts load and the glyphs are not a fallback face — check=true anyLoaded=true faces=20 families=KaTeX_AMS,KaTeX_Caligraphic,KaTeX_Fraktur,KaTeX_Main status=loaded width(KaTeX_Main)=247 width(missing font)=245
PASS  a click on <summary> opens and closes the disclosure — wasOpen=false afterFirstClick=true stillOpenAfter900ms=true attr=true afterSecondClick=false text="MoreHidden body."
PASS  hovering a footnote reference previews its definition — present=true visible=true text="The footnote body the hover preview must show." hoveredAt=379,352
PASS  backlinks panel lists the linking document and opens it on click — present=true visible=true hostAnswered=true entries=1 first="links-here.mdlinks-here.mdThis one point" clicked=true rightOfEditor=true panelLeft=496 editorRight=496 borderLeft=1px borderRight=0px toggleAfterPanel=true tocSide=hidden
PASS  focus mode hides the chrome and gives it back — bodyFlag=true toolbar=hidden matchesRule=true sheetRules=1 toc=hidden progress=hidden exitButton=true restored=true bodyClass="vscode-dark theme-frame-dark dark-theme focus-mode"
PASS  dragging the handle reorders the block — moved=true draggedBlockChangedIndex=true index 1->19 source="Some bold text" target="[[" dataTransferTypes=""
      before: ▼Heading One|Some bold text|Column AColumn|Task item chec|javascript 1co|flowchart TD
 |#m200-mermaid-|An alert block|||Inline math ab|∫01x2dx\int_0^|
      after:  ▼Heading One|Column AColumn|Task item chec|javascript 1co|flowchart TD
 |#m162-mermaid-|An alert block|||Inline math ab|∫01x2dx\int_0^|MoreHidden bod|
PASS  double-click image rename could be driven — picked the last of 2 icon.png img(s) of 4 total; src was https://file%2B.vscode-resource.vscode-cdn.net/tmp/tuimd-flo...; nodes now on icon-renamed=2 after 253ms (0 means the host never answered or the plugin never updated the node; the host records what the file holds)
PASS  export button could be driven for both formats — clicked #btn-export-go for docx and pdf; the host checks what they wrote
PASS  the Collapsible entry is reachable by the word 'more' and opens what it inserts — filtered=3 first="CollapsibleCollapsib" detailsInDoc=2 domOpen=true documentSaysOpen=false caretInSummary=true
PASS  no CSP violation in the console — 3 console entries, none CSP

63 checks: 63 passed, 0 failed
```

---

## 7. Câu chữ đề xuất cho tài liệu gốc (Ràng buộc 1)

### 7.1. `CHANGELOG.md` (dưới mục `## [Unreleased]`)

> ### Added
> - **Cross-file heading fragment navigation (#171)**: Following a wiki link (`[[Note#Heading]]`, `[[Note#Heading|alias]]`) or markdown link (`[text](other.md#heading)`) with a `#heading` fragment now scrolls the opened target document to the matching heading, supporting both Obsidian heading-text fragments and GitHub-style slug fragments across unopened custom editors, already-open custom editor tabs, and the standard text editor fallback.
>
> ### Fixed
> - **Wiki links with `#heading` or `#^block-id` fragments (#170)**: `[[Note#Heading]]`, `[[Note#Heading|alias]]`, and `[[Note#^block-id]]` now strip the fragment before resolving the target file so they open `Note.md` (or offer to create `Note.md` when missing) instead of looking for or offering to create a filename containing `#`. Same-document wiki links (`[[#Heading]]`) now scroll directly within the current document without opening a file.

### 7.2. `README.md`

> - **Wiki Links & Heading Fragments**: Link between notes with `[[Note]]`, `[[Note|Alias]]`, `[[Note#Heading]]`, or same-note `[[#Heading]]`, as well as standard Markdown links `[text](other.md#heading)`. Clicking a link with a `#heading` fragment opens the target note and scrolls directly to the matching section.

### 7.3. `AGENTS.md` (trong cây thư mục `src/host/`)

> - `fragmentNavigation.ts` — Cross-file `#heading` navigation (#171): `panelsByDoc` / `pendingByDoc` keyed by `fragmentDocKey`, `openWithFragment` (delivers `scrollTo` on `ready` when unopened, posts `scrollTo` directly when already open in the custom editor, or calls `revealRange` via `findHeadingLine` when opened in the standard text editor)

---

## 8. Đặc tả floor check đề xuất cho #171 (Ràng buộc 8)

### Mục tiêu
Kiểm chứng đầu-cuối trên VS Code 1.85.0 + Chromium thật rằng khi đi theo một liên kết có `#heading` sang file `.md` khác:
1. **Ca đích chưa mở (unopened target):** mở file đích bằng custom editor, cuộn tới đúng heading nằm dưới sơ đồ Mermaid/ảnh và nhiều đoạn văn (ngoài vùng nhìn ban đầu), và giữ `document.isDirty === false`.
2. **Ca đích đã mở sẵn (already-open target):** khi tab đích đang mở sẵn và đã cuộn về đầu trang (`scrollTop = 0`), đi theo liên kết sang một heading khác trong file đích sẽ gửi `scrollTo` trực tiếp tới webview đang mở, cuộn tới heading mới mà không cần mở lại tab, và giữ `document.isDirty === false`.

### Chuẩn bị dữ liệu trong workspace tạm của floor test
- Trong `links-here.md` (hoặc fixture phụ đặt cạnh `sample.md`), đặt đủ nội dung cao vượt quá 2 màn hình (`> 1500px`) phía trên `## Deep Section` và `## Second Deep Section` (bao gồm cả một khối Mermaid hoặc nhiều đoạn văn) để tại vị trí mở mặc định (`scrollTop === 0`), cả hai heading đều nằm ngoài viewport (`el.getBoundingClientRect().top > scroller.getBoundingClientRect().bottom`).
- Trong `sample.md`, thêm hai liên kết: một wiki link `[[links-here#Deep Section]]` (kiểu Obsidian heading text) và một markdown link `[Jump](links-here.md#second-deep-section)` (kiểu GitHub slug).

### Thao tác và phép đo
1. **Ca 1 — Đích chưa mở (`[[links-here#Deep Section]]`):**
   - Đảm bảo `links-here.md` đang đóng.
   - Trong webview của `sample.md`, click vào `.wiki-link[data-filename="links-here#Deep Section"]`.
   - Đợi tab `links-here.md` mở và webview của nó mount xong.
   - Đọc từ webview của `links-here.md` (sau tối đa 1500ms để chốt 50ms + layout hoàn tất):
     - `scroller = document.getElementById("editor-container")`
     - `heading = Array.from(document.querySelectorAll(".tiptap h2")).find(h => h.textContent?.includes("Deep Section"))`
     - `offsetFromScrollerTop = heading.getBoundingClientRect().top - scroller.getBoundingClientRect().top`
   - Đọc từ extension host: `targetDoc.isDirty` (sau khi chờ 400ms lớn hơn cửa sổ debounce 300ms của `ContentSync`).
   - **Khẳng định (Assertions):**
     - `scroller.scrollTop > 0`
     - `offsetFromScrollerTop >= 0 && offsetFromScrollerTop <= 120` (heading nằm ở vùng đỉnh của `#editor-container`, quanh ngưỡng `60px` mà `scrollEditorToHeading` đặt)
     - `targetDoc.isDirty === false` (transaction `setTextSelection` trong `scrollEditorToHeading` không làm bẩn tài liệu đích).
2. **Ca 2 — Đích đã mở sẵn (`[Jump](links-here.md#second-deep-section)`):**
   - Giữ tab `links-here.md` đang mở từ Ca 1; đặt lại `scroller.scrollTop = 0` trong webview của `links-here.md`.
   - Chuyển về `sample.md` và click vào `a[href="links-here.md#second-deep-section"]`.
   - Trong webview của `links-here.md`, đo vị trí của `<h2>Second Deep Section</h2>` so với đỉnh `#editor-container` và kiểm tra `targetDoc.isDirty` trên host.
   - **Khẳng định (Assertions):**
     - `scroller.scrollTop > 0`
     - `offsetFromScrollerTop >= 0 && offsetFromScrollerTop <= 120` cho `Second Deep Section`
     - `targetDoc.isDirty === false`.

### Phá cái gì thì check này phải đỏ (Teeth của floor check)
1. Xóa `ctx.webview.postMessage({ type: "scrollTo", fragment })` trong handler `ready` của `src/host/messageHandlers.ts` → **Ca 1 đỏ** (`scroller.scrollTop === 0`, heading nằm dưới đáy viewport).
2. Xóa `target?.webview.postMessage({ type: "scrollTo", fragment })` trong nhánh `existing.length > 0` của `src/host/fragmentNavigation.ts` → **Ca 2 đỏ** (`scroller.scrollTop === 0`).
3. Thay `scheduleLatchedScroll` trong `src/webview/main.ts` bằng `requestAnimationFrame` đơn lẻ khi cửa sổ bị che hoặc bỏ `guardTransaction: (fn) => contentSync.guardExtensionUpdate(fn)` trong `scrollToHeading` → check `scrollTop > 0` (khi cửa sổ bị che) hoặc `targetDoc.isDirty === false` (khi tài liệu có thay đổi nối tiếp) đỏ.
