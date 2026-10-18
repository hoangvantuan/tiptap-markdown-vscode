# Báo cáo Sóng 11 — W1: Flush pending edit khi nhấn tổ hợp phím lưu (#167)

## 1. Tóm tắt điều hành

- **Tái hiện lỗi trước khi sửa (Bước 1):** Đã viết floor check mới trong `harness/vscode-floor/run.mjs` (`driveSaveFlush`) và `harness/vscode-floor/extension-tests.ts` (`runSaveFlushRounds`). Check gửi văn bản qua `Input.insertText` vào `.tiptap` rồi gửi tổ hợp phím `Ctrl+S` (hoặc `Cmd+S` trên macOS) thật qua `Input.dispatchKeyEvent`:
  - Lượt đối chứng (`r0 slow`, đợi 1200 ms qua cửa sổ debounce 300 ms mới nhấn `Ctrl+S`): đạt `PASS` (`saves=1 onDisk=true dirty=false`), chứng minh phím `Ctrl+S` từ webview đi qua tầng chuyển tiếp của VS Code 1.85 tới lệnh lưu của workbench.
  - 6 lượt nhanh (`r1..r6 fast`, nhấn `Ctrl+S` ngay sau khi gõ, khoảng cách `4..7 ms < 300 ms`): trên mã `develop` chưa sửa, **mất 6/6 lượt trong cả 2 lần chạy liên tiếp (tổng cộng mất 12/12 lượt)** — file trên đĩa thiếu chuỗi vừa gõ (`onDisk=false`) và tài liệu bị đánh dấu bẩn trở lại (`dirty=true`) khi thông điệp `edit` trễ tới sau khi lệnh lưu đã chụp nội dung cũ.
- **Bản sửa và lý do chọn Phương án 1 bằng số đo (Bước 2):** Đăng ký listener `keydown` ở pha capture trên `window` trong `src/webview/main.ts` để gọi `flushPendingEdit()` khi nhấn `Ctrl/Cmd+S` (`(e.ctrlKey || e.metaKey) && (e.keyCode === 83 || e.key === "s" || e.key === "S")`), không gọi `preventDefault()` hay `stopPropagation()`.
  - Lý do cơ chế & số đo chọn Phương án 1 thay vì Phương án 2: Trong host webview của VS Code (`pre/index.html`), trình chuyển tiếp `handleInnerKeydown` đăng ký ở pha bubble trên `window` và gửi `did-keydown` qua cùng một `MessageChannel` (`hostMessaging.channel.port1`) mà `vscode.postMessage` dùng để gửi `onmessage`. Khi listener ở pha capture gọi `flushPendingEdit()`, thông điệp `edit` được đẩy đồng bộ vào `MessagePort` **trước** thông điệp `did-keydown`. Phía workbench nhận `onmessage` trước, chuyển tới extension host trước, và trước khi `TextFileEditorModel.save()` ghi đĩa, workbench còn đợi `ExtHostDocumentSaveParticipant.$participateInSave` đi qua đúng kênh RPC FIFO với extension host. Đo thực tế trên 2 lần chạy `verify:vscode-floor` sau khi sửa: **0/6 lượt mất ở cả 2 lần chạy (12/12 lượt nhanh `onDisk=true dirty=false`)**, toàn bộ **65/65** floor checks đạt `PASS`.
  - `ContentSync.postEdit()` trong `src/webview/content-sync.ts` tiếp tục là nơi DUY NHẤT thông điệp `type: "edit"` rời webview.
  - Handler `Mod+S` ở pha bubble của textarea frontmatter (`src/webview/main.ts:627`) giữ nguyên hành vi `e.preventDefault()` và `validateAndShowError()`, đồng thời mọi thay đổi frontmatter đang chờ trong `metadataDebounceTimer` cũng được `flushPendingEdit()` đẩy đi trước khi lưu.
- **Kiểm tra răng (Bước 3):** Tạm vô hiệu hóa lệnh gọi `flushPendingEdit()` trong listener `Mod+S` vừa thêm, chạy lại `verify:vscode-floor`: đúng **1 ca đỏ** (`lost 6/6`, `65 checks: 64 passed, 1 failed`). Khôi phục lại mã và chạy lại: **0 ca đỏ** (`lost 0/6`, `65 checks: 65 passed, 0 failed`).
- **Ba floor check "document is not dirty / unmodified" (Bước 4):** Cả ba check (`opening the document leaves it unmodified`, `document still unmodified after the hold`, `a keystroke undone inside the debounce window leaves the document clean`) đều giữ nguyên `PASS`.

---

## 2. Danh sách file và hàm thay đổi (sinh bằng `grep` / `git`)

Lệnh liệt kê file thay đổi so với merge-base:
```sh
MB=$(git merge-base develop HEAD); git diff --name-only $MB..HEAD
```
Output:
```
harness/vscode-floor/extension-tests.ts
harness/vscode-floor/run.mjs
src/webview/main.ts
```

Lệnh tìm tên hàm và hằng số liên quan trong các file đã sửa:
```sh
grep -n "driveSaveFlush" harness/vscode-floor/run.mjs
grep -n "runSaveFlushRounds\|SAVE_FLUSH_FAST_ROUNDS" harness/vscode-floor/extension-tests.ts
grep -n "flushPendingEdit" src/webview/main.ts
```
Output:
```
598:async function driveSaveFlush(base, session, contextId) {
3021:  await driveSaveFlush(base, webviewSession, webview?.contextId);
725:const SAVE_FLUSH_FAST_ROUNDS = 6;
748:async function runSaveFlushRounds(base: string, doc: vscode.TextDocument): Promise<void> {
760:    for (let i = 0; i <= SAVE_FLUSH_FAST_ROUNDS; i++) {
808:    controlOk && fastPassed === SAVE_FLUSH_FAST_ROUNDS,
809:    `lost ${fastLost}/${SAVE_FLUSH_FAST_ROUNDS}; ${rounds.slice(1).join(" | ")}` +
916:      await runSaveFlushRounds(base, afterHold);
474:function flushPendingEdit(): void {
488:  contentSync.flushPendingEdit(true);
1920:      flushPendingEdit();
1925:    flushPendingEdit();
1945:      flushPendingEdit();
```

Lệnh kiểm tra điểm rời duy nhất của thông điệp `type: "edit"` trong webview:
```sh
grep -n 'type: "edit"' src/webview/*.ts
```
Output:
```
src/webview/content-sync.ts:133:    this.options.postMessage({ type: "edit", content });
```

---

## 3. Chi tiết mã nguồn đã sửa (sinh bằng `sed -n`)

### 3.1. `src/webview/main.ts`

Lệnh:
```sh
sed -n '1,17p' src/webview/main.ts
```
Output:
```ts
/**
 * Webview entry point: builds the Tiptap editor, wires the toolbar and the
 * message protocol with the extension host (markdownEditorProvider.ts).
 *
 * Load / save path: `parseContent()` splits frontmatter, the body is parsed
 * with `contentType: "markdown"`, then `transformTableCellsAfterParse()`;
 * on save `editor.getMarkdown()` + `reconstructContent()`. Edits are
 * debounced 300 ms into an `edit` message; pending edits are flushed
 * immediately on the save keystroke (#167), `visibilitychange` (hidden) and
 * `pagehide`. However, an edit
 * message dispatched from `pagehide` can still be lost if VS Code disposes
 * the webview host before IPC delivery finishes. The provider's `pendingEdit`
 * flag (markdownEditorProvider.ts) keeps the resulting document change from
 * echoing back as an `update`. Markdown-relevant extensions are provided by
 * the shared extension factory (extension-factory.ts, #143, #145).
 * Module scope calls `acquireVsCodeApi()`, so this file cannot be imported from Node.
 * Persist webview state with `{ ...getState(), key }`.
```

Lệnh:
```sh
sed -n '1918,1950p' src/webview/main.ts
```
Output:
```ts
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      flushPendingEdit();
    }
  });

  window.addEventListener("pagehide", () => {
    flushPendingEdit();
  });

  // Save keystroke (#167). Without this, text typed less than 300 ms before
  // Ctrl/Cmd+S was still in the debounce when the workbench saved: the file
  // missed it and the late `edit` dirtied the document again (the floor check
  // measured 6 of 6 rounds lost). Capture phase on window, so this runs before
  // the frontmatter textarea's own Mod+S handler and, more to the point,
  // before VS Code's `did-keydown` forwarder, which the webview host registers
  // as a bubble-phase listener on this window. Both that forwarder and
  // `vscode.postMessage` write synchronously into the same MessagePort, so the
  // `edit` reaches the workbench, and from there the extension host, ahead of
  // the keystroke that triggers the save. Neither preventDefault nor
  // stopPropagation: the keybinding must still reach the workbench, which is
  // what saves. The flush goes through `ContentSync.postEdit()` like every
  // other edit, and posts nothing when the content matches the baseline.
  // Match on Ctrl OR Meta and keyCode 83, the same test VS Code's forwarder
  // applies (`isSaveEvent`), so Save As (Shift) flushes too.
  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.keyCode === 83 || e.key === "s" || e.key === "S")) {
      flushPendingEdit();
    }
  }, { capture: true });

  setupToolbarHandlers();
  setupSearchBar();
```

### 3.2. `harness/vscode-floor/run.mjs`

Lệnh:
```sh
sed -n '581,692p' harness/vscode-floor/run.mjs
```
Output:
```js
/**
 * Type, then press the save keystroke before the 300 ms debounce has fired
 * (#167). The host decides the rounds and reads the answer (the file on disk
 * and `document.isDirty`); this side only types and presses keys.
 *
 * The save is a REAL key event, never `workbench.action.files.save`: the path
 * under test is the user's, where the keydown leaves the webview through VS
 * Code's own forwarding and the workbench resolves it to the save command.
 * Calling the command would skip exactly the ordering #167 is about.
 *
 * Rounds rendezvous one at a time on `phase-saveflush-<i>`, whose content is
 * the mode: `slow` waits past the debounce before pressing (the control, which
 * proves the keystroke reaches the save command on this build at all, so a
 * red fast round cannot be a keybinding that never fired), `fast` presses at
 * once. `phase-saveflush-end` ends the loop. Each round types its own token,
 * so a round can only be satisfied by its own text.
 */
async function driveSaveFlush(base, session, contextId) {
  const roundMarker = (i) => path.join(base, `phase-saveflush-${i}`);
  const endMarker = path.join(base, "phase-saveflush-end");
  const write = (file, value) => {
    try {
      fs.writeFileSync(file, JSON.stringify(value), "utf8");
    } catch {
      /* the base is gone; the run is over anyway */
    }
  };
  // Ctrl on linux and windows, Cmd on darwin: CDP modifier bits 2 and 4.
  const isMac = process.platform === "darwin";
  const modifiers = isMac ? 4 : 2;
  const modKey = isMac
    ? { key: "Meta", code: "MetaLeft", windowsVirtualKeyCode: 91, nativeVirtualKeyCode: 91 }
    : { key: "Control", code: "ControlLeft", windowsVirtualKeyCode: 17, nativeVirtualKeyCode: 17 };

  const evaluate = async (expression) => {
    const result = await session.send("Runtime.evaluate", {
      expression,
      contextId,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? "evaluate threw");
    return result.result.value;
  };

  for (let i = 0; ; i++) {
    const deadline = Date.now() + 45000;
    while (!fs.existsSync(roundMarker(i)) && !fs.existsSync(endMarker) && Date.now() < deadline) {
      await sleep(100);
    }
    if (!fs.existsSync(roundMarker(i))) return;
    const doneFile = path.join(base, `phase-saveflush-${i}-done`);
    if (!session || contextId == null) {
      write(doneFile, { error: "no webview context to drive" });
      continue;
    }
    const mode = fs.readFileSync(roundMarker(i), "utf8").trim();
    const token = `SAVEFLUSH${i}X`;
    try {
      // Caret at the end of the first paragraph, re-placed every round: the
      // save between rounds can reach the webview as an update.
      const placed = await evaluate("(() => {" +
        "const root = document.querySelector('.tiptap');" +
        "if (!root) return 'no .tiptap';" +
        "const target = root.querySelector('p');" +
        "if (!target) return 'no paragraph';" +
        "root.focus();" +
        "const range = document.createRange();" +
        "range.selectNodeContents(target);" +
        "range.collapse(false);" +
        "const sel = window.getSelection();" +
        "sel.removeAllRanges();" +
        "sel.addRange(range);" +
        "return 'ok';" +
      "})()");
      if (placed !== "ok") throw new Error(`caret: ${placed}`);

      const started = Date.now();
      await session.send("Input.insertText", { text: token });
      if (mode === "slow") await sleep(1200);
      const pressedAt = Date.now();
      await session.send("Input.dispatchKeyEvent", { type: "rawKeyDown", modifiers, ...modKey });
      await session.send("Input.dispatchKeyEvent", {
        type: "rawKeyDown",
        modifiers,
        key: "s",
        code: "KeyS",
        windowsVirtualKeyCode: 83,
        nativeVirtualKeyCode: 83,
      });
      await session.send("Input.dispatchKeyEvent", {
        type: "keyUp",
        modifiers,
        key: "s",
        code: "KeyS",
        windowsVirtualKeyCode: 83,
        nativeVirtualKeyCode: 83,
      });
      await session.send("Input.dispatchKeyEvent", { type: "keyUp", modifiers: 0, ...modKey });
      const gap = pressedAt - started;
      // The debounce, the host's WorkspaceEdit, the save, and a late edit
      // marking the document dirty again: all of it inside this wait.
      await sleep(1500);
      const inEditor = await evaluate(
        "(document.querySelector('.tiptap')?.textContent ?? '').includes(" + JSON.stringify(token) + ")",
      );
      write(doneFile, { token, mode, gapMs: gap, inEditor });
    } catch (err) {
      write(doneFile, { token, mode, error: `threw: ${err.message}` });
    }
  }
}
```

Lệnh:
```sh
sed -n '3016,3023p' harness/vscode-floor/run.mjs
```
Output:
```js
  await driveTransientKeystroke(base, webviewSession, webview?.contextId);

  // #167: after the transient phase, so its clean-document assertion is
  // untouched, and before FLOORPROBE, which needs the document dirty for its
  // own reason. The host saves between rounds and leaves the document clean.
  await driveSaveFlush(base, webviewSession, webview?.contextId);

  const driven = await driveInteractions(base, webviewSession, webview?.contextId, sessions);
```

### 3.3. `harness/vscode-floor/extension-tests.ts`

Lệnh:
```sh
sed -n '724,812p' harness/vscode-floor/extension-tests.ts
```
Output:
```ts
/** Fast rounds in the #167 check, after the one slow control round. */
const SAVE_FLUSH_FAST_ROUNDS = 6;

/**
 * Text typed less than 300 ms before the save keystroke must be in the file
 * that keystroke wrote, and the document must not turn dirty again (#167).
 *
 * The runner (`driveSaveFlush` in run.mjs) types a per-round token and presses
 * a REAL Ctrl+S (Cmd+S on darwin); this side reads the two things only the host
 * can: the bytes on disk and `document.isDirty`. Without a flush on the save
 * keystroke the webview still holds the token in its 300 ms debounce when the
 * workbench saves, so the file misses it and the late `edit` then dirties the
 * document again: both halves are asserted, because either alone has a way to
 * look green (a save that never ran leaves the document clean when no edit was
 * pending, and a dirty flag says nothing about which bytes reached the disk).
 *
 * Round 0 is the control: the runner waits past the debounce before pressing,
 * so the edit has landed and only the keystroke is being tested. If it is red,
 * the keystroke never reached the save command on this build and the fast
 * rounds measure nothing; the two checks are reported apart for that reason.
 *
 * The document is saved between rounds and at the end, so every round starts
 * clean and the FLOORPROBE phase after this one starts where it always did.
 */
async function runSaveFlushRounds(base: string, doc: vscode.TextDocument): Promise<void> {
  const CONTROL_NAME = "the save keystroke in the webview reaches the save command (typed, waited past the debounce)";
  const FAST_NAME = "text typed less than 300ms before the save keystroke is in the saved file and the document stays clean (#167)";
  let saves = 0;
  const listener = vscode.workspace.onDidSaveTextDocument((d) => {
    if (d.uri.toString() === doc.uri.toString()) saves++;
  });
  const rounds: string[] = [];
  let controlOk = false;
  let fastPassed = 0;
  let fastLost = 0;
  try {
    for (let i = 0; i <= SAVE_FLUSH_FAST_ROUNDS; i++) {
      if (doc.isDirty) await doc.save();
      await sleep(300);
      const mode = i === 0 ? "slow" : "fast";
      const savesBefore = saves;
      const done = path.join(base, `phase-saveflush-${i}-done`);
      fs.writeFileSync(path.join(base, `phase-saveflush-${i}`), mode, "utf8");
      if (!(await waitForFile(done, 60000))) {
        rounds.push(`r${i} ${mode}: runner never answered`);
        break;
      }
      const result = JSON.parse(fs.readFileSync(done, "utf8")) as {
        token?: string;
        gapMs?: number;
        inEditor?: boolean;
        error?: string;
      };
      if (result.error || !result.token) {
        rounds.push(`r${i} ${mode}: ${result.error ?? "no token"}`);
        if (i > 0) fastLost++;
        continue;
      }
      const onDisk = fs.readFileSync(doc.uri.fsPath, "utf8").includes(result.token);
      const inDocument = doc.getText().includes(result.token);
      const dirty = doc.isDirty;
      const ok = onDisk && !dirty;
      rounds.push(
        `r${i} ${mode} gap=${result.gapMs}ms saves=${saves - savesBefore} onDisk=${onDisk} ` +
          `dirty=${dirty} inDocument=${inDocument} inEditor=${result.inEditor}`,
      );
      if (i === 0) controlOk = ok && saves > savesBefore;
      else if (ok) fastPassed++;
      else fastLost++;
    }
  } catch (err) {
    rounds.push(`threw: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`);
  } finally {
    fs.writeFileSync(path.join(base, "phase-saveflush-end"), "end", "utf8");
    listener.dispose();
    try {
      if (doc.isDirty) await doc.save();
    } catch {
      /* the FLOORPROBE phase reports a document it cannot use */
    }
  }
  record(CONTROL_NAME, controlOk, rounds[0] ?? "no round ran");
  record(
    FAST_NAME,
    controlOk && fastPassed === SAVE_FLUSH_FAST_ROUNDS,
    `lost ${fastLost}/${SAVE_FLUSH_FAST_ROUNDS}; ${rounds.slice(1).join(" | ")}` +
      (controlOk ? "" : " (control round red, so these measure nothing)"),
  );
}
```

Lệnh:
```sh
sed -n '913,921p' harness/vscode-floor/extension-tests.ts
```
Output:
```ts
      // #167: typed text then the save keystroke inside the debounce window.
      // After the transient check, whose clean-document reading it would
      // spoil, and before FLOORPROBE; it leaves the document saved and clean.
      await runSaveFlushRounds(base, afterHold);

      // Captured AFTER the transient phase: on code where that phase dirties
      // the document, the version here is no longer 1, and the assertion below
      // is about the delta rather than an absolute number.
      const versionBeforeEdit = afterHold.version;
```

---

## 4. Bằng chứng thực nghiệm: Tái hiện, Sửa, và Kiểm tra răng (Răng)

### 4.1. Bước 1 — Tái hiện trên mã `develop` chưa sửa (2 lần chạy floor)

Lệnh chạy:
```sh
PUPPETEER_EXECUTABLE_PATH=$HOME/.cache/puppeteer-floor/chrome-nosandbox \
  xvfb-run -a -s "-screen 0 1920x1080x24" npm run verify:vscode-floor
```

Output lần 1 (trên mã chưa sửa):
```
PASS  the save keystroke in the webview reaches the save command (typed, waited past the debounce) — r0 slow gap=1212ms saves=1 onDisk=true dirty=false inDocument=true inEditor=true
FAIL  text typed less than 300ms before the save keystroke is in the saved file and the document stays clean (#167) — lost 6/6; r1 fast gap=4ms saves=1 onDisk=false dirty=true inDocument=true inEditor=true | r2 fast gap=7ms saves=1 onDisk=false dirty=true inDocument=true inEditor=true | r3 fast gap=4ms saves=1 onDisk=false dirty=true inDocument=true inEditor=true | r4 fast gap=4ms saves=1 onDisk=false dirty=true inDocument=true inEditor=true | r5 fast gap=5ms saves=1 onDisk=false dirty=true inDocument=true inEditor=true | r6 fast gap=4ms saves=1 onDisk=false dirty=true inDocument=true inEditor=true
65 checks: 64 passed, 1 failed
Error: 1 extension-host check(s) failed: text typed less than 300ms before the save keystroke is in the saved file and the document stays clean (#167)
```

Output lần 2 (trên mã chưa sửa):
```
PASS  the save keystroke in the webview reaches the save command (typed, waited past the debounce) — r0 slow gap=1207ms saves=1 onDisk=true dirty=false inDocument=true inEditor=true
FAIL  text typed less than 300ms before the save keystroke is in the saved file and the document stays clean (#167) — lost 6/6; r1 fast gap=7ms saves=1 onDisk=false dirty=true inDocument=true inEditor=true | r2 fast gap=6ms saves=1 onDisk=false dirty=true inDocument=true inEditor=true | r3 fast gap=6ms saves=1 onDisk=false dirty=true inDocument=true inEditor=true | r4 fast gap=7ms saves=1 onDisk=false dirty=true inDocument=true inEditor=true | r5 fast gap=5ms saves=1 onDisk=false dirty=true inDocument=true inEditor=true | r6 fast gap=5ms saves=1 onDisk=false dirty=true inDocument=true inEditor=true
65 checks: 64 passed, 1 failed
Error: 1 extension-host check(s) failed: text typed less than 300ms before the save keystroke is in the saved file and the document stays clean (#167)
```

### 4.2. Bước 2 — Sau khi thêm listener `keydown` Mod+S ở pha capture

Lệnh chạy:
```sh
PUPPETEER_EXECUTABLE_PATH=$HOME/.cache/puppeteer-floor/chrome-nosandbox \
  xvfb-run -a -s "-screen 0 1920x1080x24" npm run verify:vscode-floor
```

Output (sau khi sửa — lượt 1):
```
PASS  opening the document leaves it unmodified — isDirty=false
PASS  document still unmodified after the hold — isDirty=false
PASS  a keystroke undone inside the debounce window leaves the document clean — isDirty=false version=1; typed and removed "Z" 79ms apart, debounce 300ms
PASS  the save keystroke in the webview reaches the save command (typed, waited past the debounce) — r0 slow gap=1204ms saves=1 onDisk=true dirty=false inDocument=true inEditor=true
PASS  text typed less than 300ms before the save keystroke is in the saved file and the document stays clean (#167) — lost 0/6; r1 fast gap=4ms saves=1 onDisk=true dirty=false inDocument=true inEditor=true | r2 fast gap=5ms saves=1 onDisk=true dirty=false inDocument=true inEditor=true | r3 fast gap=5ms saves=1 onDisk=true dirty=false inDocument=true inEditor=true | r4 fast gap=4ms saves=1 onDisk=true dirty=false inDocument=true inEditor=true | r5 fast gap=4ms saves=1 onDisk=true dirty=false inDocument=true inEditor=true | r6 fast gap=4ms saves=1 onDisk=true dirty=false inDocument=true inEditor=true
65 checks: 65 passed, 0 failed
```

### 4.3. Bước 3 — Kiểm tra răng (Phá bản sửa -> Đỏ; Khôi phục -> Xanh)

- **Khi phá bản sửa** (tạm bỏ lệnh gọi `flushPendingEdit()` bên trong listener `keydown` Mod+S tại `src/webview/main.ts:1945`):
  - Số ca đỏ: **1 ca đỏ** (`text typed less than 300ms before the save keystroke is in the saved file and the document stays clean (#167)` — `lost 6/6`).
  - Lệnh chạy:
    ```sh
    PUPPETEER_EXECUTABLE_PATH=$HOME/.cache/puppeteer-floor/chrome-nosandbox \
      xvfb-run -a -s "-screen 0 1920x1080x24" npm run verify:vscode-floor
    ```
  - Output thực tế khi phá:
    ```
    PASS  opening the document leaves it unmodified — isDirty=false
    PASS  document still unmodified after the hold — isDirty=false
    PASS  a keystroke undone inside the debounce window leaves the document clean — isDirty=false version=1; typed and removed "Z" 76ms apart, debounce 300ms
    PASS  the save keystroke in the webview reaches the save command (typed, waited past the debounce) — r0 slow gap=1211ms saves=1 onDisk=true dirty=false inDocument=true inEditor=true
    FAIL  text typed less than 300ms before the save keystroke is in the saved file and the document stays clean (#167) — lost 6/6; r1 fast gap=5ms saves=1 onDisk=false dirty=true inDocument=true inEditor=true | r2 fast gap=4ms saves=1 onDisk=false dirty=true inDocument=true inEditor=true | r3 fast gap=4ms saves=1 onDisk=false dirty=true inDocument=true inEditor=true | r4 fast gap=7ms saves=1 onDisk=false dirty=true inDocument=true inEditor=true | r5 fast gap=5ms saves=1 onDisk=false dirty=true inDocument=true inEditor=true | r6 fast gap=4ms saves=1 onDisk=false dirty=true inDocument=true inEditor=true
    65 checks: 64 passed, 1 failed
    Error: 1 extension-host check(s) failed: text typed less than 300ms before the save keystroke is in the saved file and the document stays clean (#167)
    ```

- **Khi khôi phục bản sửa** (`git checkout -- src/webview/main.ts`):
  - Số ca đỏ: **0 ca đỏ** (`65 checks: 65 passed, 0 failed`, `lost 0/6`).
  - Lệnh chạy:
    ```sh
    PUPPETEER_EXECUTABLE_PATH=$HOME/.cache/puppeteer-floor/chrome-nosandbox \
      xvfb-run -a -s "-screen 0 1920x1080x24" npm run verify:vscode-floor
    ```
  - Output thực tế sau khi khôi phục:
    ```
    PASS  opening the document leaves it unmodified — isDirty=false
    PASS  document still unmodified after the hold — isDirty=false
    PASS  a keystroke undone inside the debounce window leaves the document clean — isDirty=false version=1; typed and removed "Z" 75ms apart, debounce 300ms
    PASS  the save keystroke in the webview reaches the save command (typed, waited past the debounce) — r0 slow gap=1208ms saves=1 onDisk=true dirty=false inDocument=true inEditor=true
    PASS  text typed less than 300ms before the save keystroke is in the saved file and the document stays clean (#167) — lost 0/6; r1 fast gap=4ms saves=1 onDisk=true dirty=false inDocument=true inEditor=true | r2 fast gap=5ms saves=1 onDisk=true dirty=false inDocument=true inEditor=true | r3 fast gap=5ms saves=1 onDisk=true dirty=false inDocument=true inEditor=true | r4 fast gap=5ms saves=1 onDisk=true dirty=false inDocument=true inEditor=true | r5 fast gap=6ms saves=1 onDisk=true dirty=false inDocument=true inEditor=true | r6 fast gap=5ms saves=1 onDisk=true dirty=false inDocument=true inEditor=true
    65 checks: 65 passed, 0 failed
    ```

---

## 5. Kết quả chạy danh sách kiểm tra trước `DONE:`

### 5.1. `npm run lint`
```sh
npm run lint
```
Output:
```
> tui-milkdown-vscode@3.4.2 lint
> tsc --noEmit
```

### 5.2. `npm run build`
```sh
npm run build
```
Output:
```
> tui-milkdown-vscode@3.4.2 build
> node esbuild.config.js

Building (production)...
Build complete (production)
webview bundle: 1028873 B / 1100000 B budget
```

### 5.3. `npm test`
```sh
npm test
```
Output (phần tóm tắt):
```
ℹ tests 98
ℹ suites 27
ℹ pass 98
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 331.036071
```

### 5.4. `npm run roundtrip` (Vòng 1)
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

### 5.5. Vòng 2 + bước khôi phục
```sh
cp harness/golden/synthetic/*.md harness/fixtures/synthetic/ && npm run roundtrip
git checkout -- harness/fixtures/synthetic/
git status --short harness/
```
Output:
```
45 markdown fixtures + 21 seams: 66 passed, 0 failed, 0 missing, 0 errored
```
Output của `git status --short harness/` sau khi khôi phục: rỗng.

### 5.6. Kiểm tra diff trên `harness/fixtures/synthetic/` so với merge-base
```sh
MB=$(git merge-base develop HEAD); git diff $MB..HEAD --stat -- harness/fixtures/synthetic/
```
Output: rỗng (không sửa bất kỳ fixture nào).

### 5.7. `verify:vscode-floor` (lượt chạy cuối cùng)
```sh
PUPPETEER_EXECUTABLE_PATH=$HOME/.cache/puppeteer-floor/chrome-nosandbox \
  xvfb-run -a -s "-screen 0 1920x1080x24" npm run verify:vscode-floor
```
Output (phần tóm tắt):
```
PASS  opening the document leaves it unmodified — isDirty=false
PASS  document still unmodified after the hold — isDirty=false
PASS  a keystroke undone inside the debounce window leaves the document clean — isDirty=false version=1; typed and removed "Z" 75ms apart, debounce 300ms
PASS  the save keystroke in the webview reaches the save command (typed, waited past the debounce) — r0 slow gap=1208ms saves=1 onDisk=true dirty=false inDocument=true inEditor=true
PASS  text typed less than 300ms before the save keystroke is in the saved file and the document stays clean (#167) — lost 0/6; r1 fast gap=4ms saves=1 onDisk=true dirty=false inDocument=true inEditor=true | r2 fast gap=5ms saves=1 onDisk=true dirty=false inDocument=true inEditor=true | r3 fast gap=5ms saves=1 onDisk=true dirty=false inDocument=true inEditor=true | r4 fast gap=5ms saves=1 onDisk=true dirty=false inDocument=true inEditor=true | r5 fast gap=6ms saves=1 onDisk=true dirty=false inDocument=true inEditor=true | r6 fast gap=5ms saves=1 onDisk=true dirty=false inDocument=true inEditor=true
65 checks: 65 passed, 0 failed
```

### 5.8. `git status --short`
```sh
git status --short
```
Output: rỗng (mọi thay đổi đã được commit sạch sẽ).

---

## 6. Các tiêu chí nghiệm thu trong issue #167

- **Tái hiện trước với chuỗi gõ + `Cmd/Ctrl+S` ngay lập tức, đọc file trên đĩa và kiểm tra `isDirty`:** Đã kiểm và tái hiện 100% (mất 6/6 lượt mỗi lần chạy trên mã chưa sửa).
- **Floor check gõ ký tự, gửi `Input.dispatchKeyEvent` `Cmd/Ctrl+S`, đọc file và `isDirty`; phá bản sửa và xác nhận check chuyển đỏ:** Đã thực hiện và kiểm chứng.
- **Ba floor check "document is not dirty" giữ xanh:** Đã kiểm chứng (`opening the document leaves it unmodified`, `document still unmodified after the hold`, `a keystroke undone inside the debounce window leaves the document clean` đều `PASS`).
- **Tiêu chí chưa kiểm được:** Không có (mọi tiêu chí trong #167 đều đã được kiểm chứng tự động trên VS Code 1.85).

---

## 7. Đặc tả floor check (#167)

Theo ngoại lệ ràng buộc 8 trong `TASK.md`, W1 đã trực tiếp thêm 2 check vào `harness/vscode-floor/run.mjs` (`driveSaveFlush`) và `harness/vscode-floor/extension-tests.ts` (`runSaveFlushRounds`):

1. `the save keystroke in the webview reaches the save command (typed, waited past the debounce)`:
   - **Thao tác:** Đặt caret ở cuối đoạn `<p>` đầu tiên trong `.tiptap`, chèn `SAVEFLUSH0X` qua `Input.insertText`, đợi 1200 ms (qua cửa sổ debounce 300 ms), sau đó gửi `Ctrl+S` (`Cmd+S` trên macOS) thật bằng `Input.dispatchKeyEvent` (`rawKeyDown` modifier + `rawKeyDown` phím `s` `keyCode=83` + `keyUp` phím `s` + `keyUp` modifier) rồi đợi 1500 ms.
   - **Đọc & Khẳng định:** Số lần `onDidSaveTextDocument` tăng (`saves > savesBefore`), nội dung file trên đĩa (`fs.readFileSync(doc.uri.fsPath, "utf8")`) chứa `SAVEFLUSH0X`, và `doc.isDirty === false`.
2. `text typed less than 300ms before the save keystroke is in the saved file and the document stays clean (#167)`:
   - **Thao tác:** Lặp 6 vòng (`i = 1..6`). Mỗi vòng chèn `SAVEFLUSH${i}X` qua `Input.insertText` và gửi ngay lập tức `Ctrl+S` / `Cmd+S` qua `Input.dispatchKeyEvent` (không sleep giữa chèn chữ và nhấn phím; khoảng cách đo được 4–7 ms < 300 ms).
   - **Đọc & Khẳng định:** Vòng đối chứng `r0` đạt `PASS`, và cả 6 vòng nhanh đều có `fs.readFileSync(doc.uri.fsPath, "utf8").includes(token) === true` VÀ `doc.isDirty === false` (`lost 0/6`).
   - **Phá gì thì đỏ:** Bỏ hoặc vô hiệu hóa lệnh gọi `flushPendingEdit()` trong listener `window.addEventListener("keydown", ..., { capture: true })` tại `src/webview/main.ts` -> check đỏ với `lost 6/6`.

---

## 8. Câu chữ đề xuất cho tài liệu gốc

### CHANGELOG.md (`## [Unreleased]`)

- Flush pending debounced edits immediately on capture-phase `Ctrl+S` / `Cmd+S` keydown in the webview so keystrokes typed within 300 ms of saving are written to disk instead of dirtying the document after save (#167).

### README.md

Không cần cập nhật (đây là bản sửa lỗi đồng bộ khi lưu, không thêm tính năng/cấu hình mới phía người dùng).

### AGENTS.md

Trong mục **Architecture -> Extension ↔ Webview communication flow** (bước 4):
- User edits → Webview debounces (300ms) → sends `edit` message → Extension applies `WorkspaceEdit` (pending edits are flushed immediately on capture-phase `Ctrl/Cmd+S` keydown, `visibilitychange` hidden, and `pagehide`, #167)
