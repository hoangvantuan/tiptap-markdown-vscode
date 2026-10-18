# Wave 11 Report: Floor Checks (`#171`, `#172`, `#177`, `#178`) + Webview Fragment Focus Fix (`#171`)

## 1. Files and Symbols Modified

### Modified files (`git diff --name-only $(git merge-base develop HEAD)..HEAD`)

```
$ git diff --name-only $(git merge-base develop HEAD)..HEAD
harness/vscode-floor/extension-tests.ts
harness/vscode-floor/run.mjs
src/webview/heading-slug.ts
src/webview/main.ts
```

### Functions added or updated (`grep`)

```
$ grep -n "function " harness/vscode-floor/run.mjs harness/vscode-floor/extension-tests.ts | grep -E "findWebviewByHeading|driveWave11Checks|runWave11FloorChecks"
harness/vscode-floor/run.mjs:3041:async function findWebviewByHeading(port, sessions, headingText, beat = () => {}, timeoutMs = 15000) {
harness/vscode-floor/run.mjs:3102:async function driveWave11Checks(base, debugPort, sessions) {
harness/vscode-floor/extension-tests.ts:896:async function runWave11FloorChecks(base: string, uri: vscode.Uri): Promise<void> {

$ grep -n "export function scrollEditorToHeading\|function scheduleScrollToHeading" src/webview/heading-slug.ts src/webview/main.ts
src/webview/heading-slug.ts:109:export function scrollEditorToHeading(
src/webview/main.ts:1646:function scheduleScrollToHeading(fragment: string): void {
```

---

## 2. Product Defect Found & Fixed in `#171` (Coordinator Option C)

When driving the `#171` floor check against an unopened target document (`[[Other#Some Heading]]`, which queues the fragment in `pendingByDoc` and replays `{ type: "scrollToHeading", fragment }` from the `ready` handler before the first `{ type: "update" }` constructs the `Editor`), two defects surfaced in `src/webview/main.ts` and `src/webview/heading-slug.ts`:

1. **`autofocus: 'start'` in `initEditor` (`src/webview/main.ts`)**: `@tiptap/core`'s `Editor` constructor schedules `setTimeout(() => this.commands.focus(this.options.autofocus), 0)`, and Tiptap's `focus('start')` command sets the selection to position 1 and schedules `requestAnimationFrame(() => { view.focus(); editor.commands.scrollIntoView(); })`. When `pendingScrollFragment !== null` at editor construction, `scheduleScrollToHeading` ran on the first animation frame (`scrollTop = 2497, headingOffset = 60, caret = "H2:▼Some Heading"`), and Tiptap's `autofocus: 'start'` timer fired immediately afterwards and yanked both the selection and `#editor-container` back to `H1` (`scrollTop = 85, headingOffset = 2472, caret = "H1:▼Other Document"`).
2. **Unfocused view after `scrollEditorToHeading(select=true)` (`src/webview/heading-slug.ts`)**: `editor.commands.setTextSelection(target + 1)` updates `editor.state.selection`, but ProseMirror's `selectionToDOM` only writes `window.getSelection()` when `view.hasFocus()` is true. Calling ProseMirror's `editor.view.focus()` directly (verified in `node_modules/prosemirror-view/src/index.ts` lines 338–343) calls `focusPreventScroll(this.dom)` (`dom.focus({ preventScroll: true })`) followed by `selectionToDOM(this)`, focusing the editor and drawing the DOM caret inside the target heading without scrolling.

### `node_modules/prosemirror-view/src/index.ts` (`sed -n '338,343p' node_modules/prosemirror-view/src/index.ts`)

```ts
  focus() {
    this.domObserver.stop()
    if (this.editable) focusPreventScroll(this.dom)
    selectionToDOM(this)
    this.domObserver.start()
  }
```

### `src/webview/heading-slug.ts` (`sed -n '109,154p' src/webview/heading-slug.ts`)

```ts
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

  if (select && typeof editor.view.focus === "function") {
    const focusView = () => editor.view.focus!();
    if (guardTransaction) {
      guardTransaction(focusView);
    } else {
      focusView();
    }
  }
  return true;
}
```

### `src/webview/main.ts` (`sed -n '889,896p' src/webview/main.ts` and `sed -n '1646,1662p' src/webview/main.ts`)

```ts
      // When a `#fragment` jump is waiting (`pendingScrollFragment !== null`),
      // suppress Tiptap's `autofocus: 'start'`: its `setTimeout(0)` ->
      // `commands.focus('start')` -> `requestAnimationFrame(scrollIntoView)`
      // fires after `scheduleScrollToHeading` and yanks both the selection and
      // `#editor-container` back to the top of the document (#171).
      autofocus: pendingScrollFragment !== null ? false : ('start' as const),
      editorProps: {
        handlePaste(view, event) {
```

```ts
function scheduleScrollToHeading(fragment: string): void {
  cancelScheduledScroll?.();
  cancelScheduledScroll = null;

  let stopObserver: (() => void) | null = null;
  const cancelLatch = scheduleLatchedScroll(() => {
    if (!scrollToHeading(fragment, "instant", true)) {
      if (editor && !editor.view.hasFocus()) {
        contentSync.guardExtensionUpdate(() => {
          editor?.commands.focus("start");
        });
      }
      return;
    }
    if (typeof ResizeObserver === "undefined") return;
```

---

## 3. Floor Checks Added (`#171`, `#172/#177`, `#178`)

### Spec vs. Code Notes

1. **`#178` (`docs/reports/w11-block-keys.md`, section 7)**:
   - The spec notes that `sample.md`'s first top-level block is `H1:Heading One` (`index 0`) and its second top-level block is `P:Some bold text...` (`index 1`), followed by the table wrapper `DIV:Column AColumn` (`index 2`). Placing the caret in the first top-level paragraph (`:scope > p`, at `index 1`) and pressing `Alt+ArrowDown` swaps `index 1` (`P`) with `index 2` (`DIV:Column AColumn`), `Alt+ArrowUp` restores `index 1`, `Mod+Enter` inserts an empty `P:` at `index 2` and moves the caret into it with `brInFirstP === 0`, and `Backspace` deletes that empty paragraph so all subsequent surface probes in `probeWebview` see the original 16 top-level blocks and intact frontmatter.
2. **`#172 / #177` (`docs/reports/w11-image-naming.md`)**:
   - The spec allows triggering `saveImage` through the real webview→host path by dispatching a `drop` event on `.tiptap` with a `File` named `"x.png"` (`type: "image/png"`) carrying the 16-byte WebP magic header. In `src/webview/main.ts`, `handleDrop` reads the `File` via `FileReader` and posts `{ type: "saveImage", data, filename: "x.png", blobUrl }` to the host, which runs `writeImage` (`src/host/saveImage.ts` + `src/host/imageFormat.ts`), writes `images/sample/x.webp`, and replies `{ type: "imageSaved" }` so the webview rewrites the `<img>` node and posts the updated markdown back to the `TextDocument`.
3. **`#171` (`docs/reports/w11-wiki-fragment.md`, section 8)**:
   - Tested both target lifecycle states:
     - `wiki`: `other.md` is closed before clicking `.wiki-link[data-filename="Other#Some Heading"]`, exercising `openWikiLink` → `fragmentNavigation.revealFragment(uri, "Some Heading")` → `pendingByDoc` → `ready` → `pendingScrollFragment` (`autofocus: false`) → `scheduleScrollToHeading`.
     - `md`: `other.md` stays open in its background custom-editor tab (`resetOtherScroll` resets `c.scrollTop = 0` and places the caret in `H1:▼Other Document`), then clicking `a[href="other.md#some-heading"]` in `sample.md` exercises `openLocalFileInEditor` → `fragmentNavigation.revealFragment(uri, "some-heading")` → `panelsByDoc` immediate `postMessage({ type: "scrollToHeading", fragment: "some-heading" })`.
     - `plain`: control link `a[href="other.md"]` with no fragment opens `other.md` at `scrollTop === 0`, `headingOffset > 300`, `caret = "H1:▼Other Document"`.

### `#178` Surface Probe in `harness/vscode-floor/run.mjs` (`sed -n '1216,1331p' harness/vscode-floor/run.mjs`)

```js
    const before = await evaluate(readBlocks);
    if (!before || before.caretIndex < 0) throw new Error("could not read initial block state");
    const sourceTag = before.blocks[before.caretIndex];
    const neighbourTag = before.blocks[before.caretIndex + 1] ?? null;

    // 1. Alt+ArrowDown moves the paragraph past its next sibling block.
    await session.send("Input.dispatchKeyEvent", { type: "rawKeyDown", modifiers: 1, ...altKey });
    await session.send("Input.dispatchKeyEvent", {
      type: "rawKeyDown", modifiers: 1, key: "ArrowDown", code: "ArrowDown",
      windowsVirtualKeyCode: 40, nativeVirtualKeyCode: 40,
    });
    await session.send("Input.dispatchKeyEvent", {
      type: "keyUp", modifiers: 1, key: "ArrowDown", code: "ArrowDown",
      windowsVirtualKeyCode: 40, nativeVirtualKeyCode: 40,
    });
    await session.send("Input.dispatchKeyEvent", { type: "keyUp", modifiers: 0, ...altKey });
    await sleepShort();
    const afterDown = await evaluate(readBlocks);

    // 2. Alt+ArrowUp moves the paragraph back to its original index.
    await session.send("Input.dispatchKeyEvent", { type: "rawKeyDown", modifiers: 1, ...altKey });
    await session.send("Input.dispatchKeyEvent", {
      type: "rawKeyDown", modifiers: 1, key: "ArrowUp", code: "ArrowUp",
      windowsVirtualKeyCode: 38, nativeVirtualKeyCode: 38,
    });
    await session.send("Input.dispatchKeyEvent", {
      type: "keyUp", modifiers: 1, key: "ArrowUp", code: "ArrowUp",
      windowsVirtualKeyCode: 38, nativeVirtualKeyCode: 38,
    });
    await session.send("Input.dispatchKeyEvent", { type: "keyUp", modifiers: 0, ...altKey });
    await sleepShort();
    const afterUp = await evaluate(readBlocks);

    // 3. Mod+Enter inserts an empty paragraph below without inserting a <br>.
    await session.send("Input.dispatchKeyEvent", { type: "rawKeyDown", modifiers: modMask, ...modKey });
    await session.send("Input.dispatchKeyEvent", {
      type: "rawKeyDown", modifiers: modMask, key: "Enter", code: "Enter",
      windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
    });
    await session.send("Input.dispatchKeyEvent", {
      type: "keyUp", modifiers: modMask, key: "Enter", code: "Enter",
      windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
    });
    await session.send("Input.dispatchKeyEvent", { type: "keyUp", modifiers: 0, ...modKey });
    await sleepShort();
    const afterInsert = await evaluate(readBlocks);

    // 4. Backspace removes the empty paragraph (or, when broken, the <br>) so
    //    the document returns to its pre-probe shape for the probes below.
    for (const type of ["keyDown", "keyUp"]) {
      await session.send("Input.dispatchKeyEvent", {
        type, key: "Backspace", code: "Backspace",
        windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8,
      });
    }
    await sleepShort();
    const afterRestore = await evaluate(readBlocks);

    const movedDown =
      afterDown.blocks.indexOf(sourceTag) === before.caretIndex + 1 &&
      afterDown.blocks[before.caretIndex] === neighbourTag &&
      afterDown.caretIndex === before.caretIndex + 1;
    const movedUp =
      afterUp.order === before.order &&
      afterUp.caretIndex === before.caretIndex;
    const insertedBelow =
      afterInsert.count === before.count + 1 &&
      afterInsert.blocks[before.caretIndex + 1] === "P:" &&
      afterInsert.caretIndex === before.caretIndex + 1 &&
      afterInsert.brInFirstP === 0;
    const restored =
      afterRestore.order === before.order &&
      afterRestore.count === before.count &&
      afterRestore.frontmatter === before.frontmatter;

    add(
      "block keys move the current block and insert a paragraph below without leaving the editor (#178)",
      movedDown && movedUp && insertedBelow && restored,
      `index=${before.caretIndex}->${afterDown.blocks.indexOf(sourceTag)}->${afterUp.caretIndex} ` +
        `swappedWith=${JSON.stringify(afterDown.blocks[before.caretIndex])} ` +
        `caretAfterDown=${afterDown.caretIndex} ` +
        `count=${before.count}->${afterInsert.count}->${afterRestore.count} ` +
        `inserted=${JSON.stringify(afterInsert.blocks[before.caretIndex + 1] ?? null)} ` +
        `caretInInserted=${afterInsert.caretIndex === before.caretIndex + 1} ` +
        `brInFirstP=${afterInsert.brInFirstP} restored=${restored} ` +
        `frontmatterIntact=${afterRestore.frontmatter === before.frontmatter}`,
    );
```

### `#172/#177` and `#171` Host Runner in `harness/vscode-floor/extension-tests.ts` (`sed -n '948,1135p' harness/vscode-floor/extension-tests.ts`)

```ts
    // ---- 1. #172 / #177: saveImage with `images/${fileName}` + WebP bytes ----
    try {
      await saveDirtyDocs();
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      await sleep(400);
      await tuiConfig.update(
        "imageSaveFolder",
        "images/${fileName}",
        vscode.ConfigurationTarget.Workspace,
      );
      await sleep(400);
      await vscode.commands.executeCommand("vscode.openWith", uri, VIEW_TYPE);
      await waitForCustomTab(20000);
      await sleep(600);

      const dropRes = await sendStep({ op: "dropWebpImage" });
      const expectedWebp = path.join(docFolder, "images", "sample", "x.webp");
      const wrongPngSub = path.join(docFolder, "images", "sample", "x.png");
      const wrongFlatWebp = path.join(docFolder, "images", "x.webp");
      const wrongFlatPng = path.join(docFolder, "images", "x.png");

      const pollDeadline = Date.now() + 5000;
      while (Date.now() < pollDeadline) {
        const liveDoc = await getSampleDoc();
        if (fs.existsSync(expectedWebp) && liveDoc.getText().includes("images/sample/x.webp")) {
          break;
        }
        await sleep(200);
      }

      const liveDoc = await getSampleDoc();
      const onDisk = fs.existsSync(expectedWebp);
      const bytesMatch = onDisk && fs.readFileSync(expectedWebp).equals(WEBP_BYTES);
      const noWrongPng = !fs.existsSync(wrongPngSub);
      const noFlatFile = !fs.existsSync(wrongFlatWebp) && !fs.existsSync(wrongFlatPng);
      const docText = liveDoc.getText();
      const inMarkdown =
        docText.includes("images/sample/x.webp") && !docText.includes("images/sample/x.png");
      const inDom = Boolean(dropRes?.ok && dropRes?.matchedWebpNode);

      record(
        SAVE_IMAGE_NAME,
        onDisk && bytesMatch && noWrongPng && noFlatFile && inMarkdown && inDom,
        `onDisk=${onDisk} bytesMatch=${bytesMatch} noWrongPng=${noWrongPng} noFlatFile=${noFlatFile} ` +
          `inMarkdown=${inMarkdown} inDom=${inDom} imgSrc=${JSON.stringify(String(dropRes?.imgSrc ?? "").slice(-40))}` +
          (dropRes?.error ? ` error=${dropRes.error}` : ""),
      );
    } catch (err) {
      record(
        SAVE_IMAGE_NAME,
        false,
        err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      );
    } finally {
      try {
        await tuiConfig.update("imageSaveFolder", origSaveFolder, vscode.ConfigurationTarget.Workspace);
      } catch {
        /* workspace is temporary */
      }
      await saveDirtyDocs();
    }

    // ---- 2. #171: Cross-file `#fragment` scroll (wiki link + markdown link) ----
    try {
      const fillerBefore = Array.from(
        { length: 35 },
        (_, idx) =>
          `Paragraph ${idx + 1} before the target heading so the heading starts well below the initial viewport fold.`,
      ).join("\n\n");
      const fillerAfter = Array.from(
        { length: 35 },
        (_, idx) =>
          `Paragraph ${idx + 1} after the target heading so the bottom of the document does not clamp scrollTop.`,
      ).join("\n\n");
      fs.writeFileSync(
        otherPath,
        `# Other Document\n\n${fillerBefore}\n\n## Some Heading\n\n${fillerAfter}\n`,
        "utf8",
      );

      await saveDirtyDocs();
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      await sleep(400);

      const liveSample = await getSampleDoc();
      const linkLine = "\n\n[Plain](other.md) [[Other#Some Heading]] [Jump](other.md#some-heading)\n";
      const insertEdit = new vscode.WorkspaceEdit();
      insertEdit.insert(uri, new vscode.Position(liveSample.lineCount, 0), linkLine);
      await vscode.workspace.applyEdit(insertEdit);
      await liveSample.save();
      await sleep(400);

      // (a) Unopened-target path via `pendingByDoc`: `other.md` has not been
      //     opened yet in this session, so `panelsByDoc` has no entry for it.
      //     Open `sample.md` and follow `[[Other#Some Heading]]`.
      await vscode.commands.executeCommand("vscode.openWith", uri, VIEW_TYPE);
      await waitForCustomTab(20000);
      await sleep(600);
      const wiki = await sendStep({
        op: "clickAndReadOther",
        selector: '.wiki-link[data-filename="Other#Some Heading"]',
        expectScroll: true,
      });
      const otherDocAfterWiki = vscode.workspace.textDocuments.find(
        (d) => d.uri.fsPath === otherPath && !d.isClosed,
      );
      const wikiDirty = otherDocAfterWiki ? otherDocAfterWiki.isDirty : true;

      // (b) Already-open-target path via `panelsByDoc` AND markdown link via
      //     `openLocalFileInEditor`: keep `other.md` open in its tab, reset its
      //     `scrollTop` to 0, switch back to `sample.md`, and follow
      //     `[Jump](other.md#some-heading)`.
      const reset = await sendStep({ op: "resetOtherScroll" });
      await vscode.commands.executeCommand("vscode.openWith", uri, VIEW_TYPE);
      await waitForCustomTab(20000);
      await sleep(600);
      const md = await sendStep({
        op: "clickAndReadOther",
        selector: 'a[href="other.md#some-heading"]',
        expectScroll: true,
      });
      const otherDocAfterMd = vscode.workspace.textDocuments.find(
        (d) => d.uri.fsPath === otherPath && !d.isClosed,
      );
      const mdDirty = otherDocAfterMd ? otherDocAfterMd.isDirty : true;

      // (c) Control: `[Plain](other.md)` with no fragment must NOT scroll.
      await saveDirtyDocs();
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      await sleep(400);
      await vscode.commands.executeCommand("vscode.openWith", uri, VIEW_TYPE);
      await waitForCustomTab(20000);
      await sleep(600);
      const plain = await sendStep({
        op: "clickAndReadOther",
        selector: 'a[href="other.md"]',
        expectScroll: false,
      });

      const caretAtStart = (c: unknown): boolean =>
        typeof c === "string" && c.startsWith("H1:") && c.includes("Other Document");
      const caretInTargetHeading = (c: unknown): boolean =>
        typeof c === "string" && c.startsWith("H2:") && c.includes("Some Heading");

      const plainOk =
        Boolean(plain?.ok) &&
        plain.scrollTop === 0 &&
        plain.headingOffset > 300 &&
        caretAtStart(plain.caretBlock);
      const wikiOk =
        Boolean(wiki?.ok) &&
        wiki.scrollTop > 0 &&
        wiki.headingOffset >= 0 &&
        wiki.headingOffset <= 140 &&
        caretInTargetHeading(wiki.caretBlock) &&
        !wikiDirty;
      const mdOk =
        Boolean(reset?.ok) &&
        reset.resetScrollTop === 0 &&
        caretAtStart(reset.resetCaret) &&
        Boolean(md?.ok) &&
        md.scrollTop > 0 &&
        md.headingOffset >= 0 &&
        md.headingOffset <= 140 &&
        caretInTargetHeading(md.caretBlock) &&
        !mdDirty;

      record(
        FRAGMENT_NAME,
        plainOk && wikiOk && mdOk,
        `plain(scrollTop=${plain?.scrollTop},offset=${plain?.headingOffset},caret=${JSON.stringify(plain?.caretBlock)}) ` +
          `wiki(scrollTop=${wiki?.scrollTop},offset=${wiki?.headingOffset},caret=${JSON.stringify(wiki?.caretBlock)},dirty=${wikiDirty}) ` +
          `md(reset=${reset?.resetScrollTop},resetCaret=${JSON.stringify(reset?.resetCaret)},scrollTop=${md?.scrollTop},offset=${md?.headingOffset},caret=${JSON.stringify(md?.caretBlock)},dirty=${mdDirty})` +
          (plain?.error ? ` plainErr=${plain.error}` : "") +
          (wiki?.error ? ` wikiErr=${wiki.error}` : "") +
          (md?.error ? ` mdErr=${md.error}` : ""),
      );
    } catch (err) {
      record(
        FRAGMENT_NAME,
        false,
        err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      );
    }
```

---

## 4. Teeth Verification (4 Scratch-Break Runs)

Each teeth run broke the product mechanism in `src/`, ran `PUPPETEER_EXECUTABLE_PATH=$HOME/.cache/puppeteer-floor/chrome-nosandbox xvfb-run -a -s "-screen 0 1920x1080x24" npm run verify:vscode-floor`, confirmed **1 failed** (`68 passed, 1 failed` out of 69 checks), and restored the file via `git checkout`.

### 4.1 `#178` Teeth: Unregister `BlockKeysExtension` in `src/webview/extension-factory.ts`

- **Scratch break**: Commented out `BlockKeysExtension,` at `src/webview/extension-factory.ts:397`.
- **Red count**: **1 check red** (`69 checks: 68 passed, 1 failed`).
- **Real output**:
  ```
  FAIL  block keys move the current block and insert a paragraph below without leaving the editor (#178) — index=1->1->1 swappedWith="P:Some bold text" caretAfterDown=1 count=16->16->16 inserted="DIV:Column AColumn" caretInInserted=false brInFirstP=2 restored=true frontmatterIntact=true
  ...
  69 checks: 68 passed, 1 failed
  ```

### 4.2 `#172 / #177` Teeth: Bypass Magic-Byte Sniffing in `src/host/imageFormat.ts`

- **Scratch break**: Added `return suggestedExt;` at the top of `correctExtension` in `src/host/imageFormat.ts:89`.
- **Red count**: **1 check red** (`69 checks: 68 passed, 1 failed`).
- **Real output**:
  ```
  FAIL  saveImage expands ${fileName} in imageSaveFolder and sniffs WebP magic bytes over a .png hint (#172, #177) — onDisk=false bytesMatch=false noWrongPng=false noFlatFile=true inMarkdown=false inDom=false imgSrc="uimd-floor-sMFOnB/ws/images/sample/x.png"
  ...
  69 checks: 68 passed, 1 failed
  ```

### 4.3 `#171` Teeth (Host): Drop Fragment in `src/host/openLocalFile.ts`

- **Scratch break**: Set `const fragment = null;` in `src/host/openLocalFile.ts:42`.
- **Red count**: **1 check red** (`69 checks: 68 passed, 1 failed`).
- **Real output**:
  ```
  FAIL  cross-file [[Note#Heading]] and [text](file.md#heading) links scroll the target editor to the heading without dirtying it (#171) — plain(scrollTop=0,offset=2557,caret="H1:▼Other Document") wiki(scrollTop=2497,offset=60,caret="H2:▼Some Heading",dirty=false) md(reset=0,resetCaret="H1:▼Other Document",scrollTop=0,offset=2557,caret="H1:▼Other Document",dirty=false)
  ...
  69 checks: 68 passed, 1 failed
  ```

### 4.4 `#171` Teeth (Webview): Revert `494c606` (`src/webview/heading-slug.ts` and `src/webview/main.ts`)

- **Scratch break**: `git checkout eb0b839 -- src/webview/heading-slug.ts src/webview/main.ts` (restoring unconditional `autofocus: 'start'` and removing `editor.view.focus()` from `scrollEditorToHeading`).
- **Red count**: **1 check red** (`69 checks: 68 passed, 1 failed`), with both `wiki` (`scrollTop=85, offset=2472, caret="H1:▼Other Document"`) and `md` (`caret="H1:▼Other Document"`) failing the check.
- **Real output**:
  ```
  FAIL  cross-file [[Note#Heading]] and [text](file.md#heading) links scroll the target editor to the heading without dirtying it (#171) — plain(scrollTop=0,offset=2557,caret="H1:▼Other Document") wiki(scrollTop=85,offset=2472,caret="H1:▼Other Document",dirty=false) md(reset=0,resetCaret="H1:▼Other Document",scrollTop=2497,offset=60,caret="H1:▼Other Document",dirty=false)
  ...
  69 checks: 68 passed, 1 failed
  ```

---

## 5. Pre-DONE Verification Outputs

### `npm run lint`

```
> tui-milkdown-vscode@3.4.2 lint
> tsc --noEmit
```

### `npm run build`

```
> tui-milkdown-vscode@3.4.2 build
> node esbuild.config.js

Building (production)...
Build complete (production)
webview bundle: 1033085 B / 1100000 B budget
```

### `npm test`

```
ℹ tests 233
ℹ suites 51
ℹ pass 233
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1395.101991
```

### `npm run roundtrip` (Pass 1 & Pass 2 + Restore)

```
$ npm run roundtrip
markdown roundtrip harness — mode: check
corpus: 46 fixtures (41 synthetic, 5 repo docs)

──────────────────────────────────────────
──────────────────────────────────────────
46 markdown fixtures + 21 seams: 67 passed, 0 failed, 0 missing, 0 errored

$ cp harness/golden/synthetic/*.md harness/fixtures/synthetic/ && npm run roundtrip && git checkout -- harness/fixtures/synthetic/ && git status --short harness/
markdown roundtrip harness — mode: check
corpus: 46 fixtures (41 synthetic, 5 repo docs)

──────────────────────────────────────────
──────────────────────────────────────────
46 markdown fixtures + 21 seams: 67 passed, 0 failed, 0 missing, 0 errored
```

### `git diff $MB..HEAD --stat -- harness/fixtures/synthetic/`

```
$ MB=$(git merge-base develop HEAD) && git diff $MB..HEAD --stat -- harness/fixtures/synthetic/
(empty — no synthetic fixtures modified)
```

### Final VS Code Floor Run (`69 checks: 69 passed, 0 failed`)

Command:

```bash
PUPPETEER_EXECUTABLE_PATH=$HOME/.cache/puppeteer-floor/chrome-nosandbox \
  xvfb-run -a -s "-screen 0 1920x1080x24" npm run verify:vscode-floor
```

Summary output (including the 3 `isDirty=false` autofocus checks and the 3 new wave-11 checks):

```
PASS  opening the document leaves it unmodified — isDirty=false
PASS  document still unmodified after the hold — isDirty=false
PASS  a keystroke undone inside the debounce window leaves the document clean — isDirty=false version=1; typed and removed "Z" 80ms apart, debounce 300ms
...
PASS  saveImage expands ${fileName} in imageSaveFolder and sniffs WebP magic bytes over a .png hint (#172, #177) — onDisk=true bytesMatch=true noWrongPng=true noFlatFile=true inMarkdown=true inDom=true imgSrc="imd-floor-riKrkN/ws/images/sample/x.webp"
PASS  cross-file [[Note#Heading]] and [text](file.md#heading) links scroll the target editor to the heading without dirtying it (#171) — plain(scrollTop=0,offset=2557,caret="H1:▼Other Document") wiki(scrollTop=2497,offset=60,caret="H2:▼Some Heading",dirty=false) md(reset=0,resetCaret="H1:▼Other Document",scrollTop=2497,offset=60,caret="H2:▼Some Heading",dirty=false)
...
PASS  block keys move the current block and insert a paragraph below without leaving the editor (#178) — index=1->2->1 swappedWith="DIV:Column AColumn" caretAfterDown=2 count=16->17->16 inserted="P:" caretInInserted=true brInFirstP=0 restored=true frontmatterIntact=true
...
69 checks: 69 passed, 0 failed
```

---

## 6. Untested Criteria

None. All criteria in `TASK.md` and the coordinator's follow-up instructions for `#171`, `#172/#177`, and `#178` were verified end-to-end in the VS Code 1.85.0 floor harness.

---

## 7. Câu chữ đề xuất cho tài liệu gốc (Proposed Root Documentation Wording)

### `CHANGELOG.md` (`## [Unreleased]`)

```markdown
- Fix cross-file `#heading` jumps into a newly opened document being yanked back to the top by Tiptap's initial `autofocus: 'start'` timer, and focus the target heading via `view.focus()` (`preventScroll`) so the caret is drawn in the heading (#171)
```

### `AGENTS.md` (under `autofocus: 'start' as const` in `initEditor()` convention bullet)

```markdown
- **`autofocus` in `initEditor()` is `pendingScrollFragment !== null ? false : ('start' as const)`.** When a `#fragment` jump arrives before the first `update` constructs the editor, Tiptap's `autofocus: 'start'` schedules `setTimeout(0)` → `commands.focus('start')` → `requestAnimationFrame(scrollIntoView)`, which fires after `scheduleScrollToHeading` and yanks both the selection and `#editor-container` back to `H1` (#171). Suppressing `autofocus` when `pendingScrollFragment !== null` and calling ProseMirror's `editor.view.focus()` (`focusPreventScroll(this.dom)` + `selectionToDOM`) inside `scrollEditorToHeading(select=true)` focuses the editor and draws the caret inside the target heading without scrolling; if the fragment matches no heading, `scheduleScrollToHeading` falls back to `commands.focus('start')` under `guardExtensionUpdate`.
```
