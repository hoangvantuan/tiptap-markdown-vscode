# Báo cáo Sóng 11 — floor checks vòng 2: #173 (hộp chọn file) và #174 (tải ảnh remote khi paste)

Worker: `wave11/floor-checks`. Nhiệm vụ: cài hai check mô tả trong
`docs/reports/w11-image-insert.md` mục 6 vào đúng hai file của floor
(`harness/vscode-floor/run.mjs`, `harness/vscode-floor/extension-tests.ts`), theo
đúng ngoại lệ của ràng buộc 8 trong `.wave11-spec/COMMON.md`. **Không sửa `src/`.**

## 1. Danh sách file thay đổi (sinh bằng `git diff --stat`)

```
$ MB=$(git merge-base develop HEAD); git diff $MB..HEAD --stat
 harness/vscode-floor/extension-tests.ts | 300 ++++++++++++++++++++++++++++++++
 harness/vscode-floor/run.mjs            | 201 +++++++++++++++++++++
 2 files changed, 501 insertions(+)
```

## 2. Vị trí trong hai file (sinh bằng `grep -n`)

```
$ grep -n "async function clickTopLevelParagraph" harness/vscode-floor/run.mjs
916:async function clickTopLevelParagraph(target, beat = () => {}, attempts = 8) {
$ grep -n 'op === "pickImageFromFile"\|op === "pasteRemoteHtml"' harness/vscode-floor/run.mjs
3382:      } else if (cmd.op === "pickImageFromFile") {
3448:      } else if (cmd.op === "pasteRemoteHtml") {
$ grep -n "PICK_NAME =\|REMOTE_NAME =\|const PNG_1X1 =\|const restoreSample =" harness/vscode-floor/extension-tests.ts
895:const PNG_1X1 = Buffer.from(
973:  const restoreSample = async (text: string): Promise<void> => {
1177:    const PICK_NAME =
1264:    const REMOTE_NAME =
```

Hai check mới là **bước 3 và bước 4** của `runWave11FloorChecks`, tức là đi tiếp
cùng giao thức marker `phase-w11-cmd-<i>` / `phase-w11-done-<i>` /
`phase-w11-end` mà #171/#172/#177/#178 đã dùng (commit `eb0b839`, `b5cfae3`).
Tên check (đúng như đặc tả):

- `insert image from file picker writes the file and inserts the relative link at the caret (#173)`
- `pasting HTML with https images respects downloadRemoteImagesOnPaste (#174)`

### 2.1. Một helper mới trong `run.mjs`: `clickTopLevelParagraph`

Cả hai check đều **chèn tại con trỏ**, mà tới lúc chạy thì con trỏ là thứ probe
trước để lại. Con trỏ nằm trong code block / ô bảng / preview mermaid thì phần
đọc phía host không thấy node, và check sẽ báo một tính năng đang tốt là hỏng.
Một DOM range viết bằng script không tới được ProseMirror (AGENTS.md), nên helper
này **bấm chuột thật** (press + release) vào một hàng `.tiptap > p` tìm được
bằng cách hỏi trang xem cái gì **DƯỚI con trỏ**, rồi **xác nhận** lựa chọn thật
sự đã dời bằng cách đọc block đang giữ anchor của DOM selection:

```js
// harness/vscode-floor/run.mjs:896 (trích bằng sed)
async function clickTopLevelParagraph(target, beat = () => {}, attempts = 8) {
  const session = target.session;
  let last = { ok: false, why: "never attempted" };
```

Vòng lặp thử lại **chờ thứ nó khẳng định** (con trỏ nằm trong một paragraph), không
phải chờ điều kiện tiên quyết. `session` lấy từ `target` vì `driveWave11Checks`
nhận một *danh sách* session chứ không có biến `session` như `driveSurfaces`
(lần chạy đầu đã lộ ra đúng điều này: `error=threw: session is not defined`).

### 2.2. PNG thật, không phải chuỗi base64 giả

```ts
// harness/vscode-floor/extension-tests.ts:895 (trích bằng sed)
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
  "base64",
);
```

Đây là PNG 1x1 thật (69 byte, kiểm bằng `file px.png` → `PNG image data, 1 x 1,
8-bit/color RGB`), vì cả hai đường đều đi qua `writeImage`, mà `writeImage` **CHỐT
phần mở rộng theo magic bytes** (#177). Một PNG giả sẽ khiến hai check này đo
phần mở rộng được sửa chứ không đo tên file thật.

### 2.3. `restoreSample`: khôi phục sample KHÔNG qua `d.save()`

```ts
// harness/vscode-floor/extension-tests.ts:973 (trích bằng sed)
  const restoreSample = async (text: string): Promise<void> => {
    await saveDirtyDocs();
    try {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    } catch {
      /* ignore */
    }
    await sleep(400);
    fs.writeFileSync(uri.fsPath, text, "utf8");
  };
```

Hai check dưới đây ghi file ảnh vào workspace rồi tham chiếu nó từ tài liệu. Lưu
phiên bản *có* tham chiếu đó sẽ bắn `onDidSaveTextDocument`, tức là phát hiện
xoá ảnh (#126): việc khôi phục sẽ đem chính file vừa ghi đi, và một ảnh còn được
tham chiếu sẽ dựng một modal prompt không ai trả lời được. Ghi thẳng file khi đã
đóng editor né được đúng cái đó.

## 3. Check #173 (`pickImageFromFile`)

**Host (`extension-tests.ts`)** — `showOpenDialog` là dialog NATIVE, nằm ngoài tầm
CDP, nên nửa đó bắt buộc phải làm trong extension host:

1. Tạo `<workspace>/picker-source/Picked Photo.png` (tên **có dấu cách** — vì
   dấu cách chính là thứ mà `<...>` trong markdown phục vụ).
2. Bọc `vscode.window.showOpenDialog` trong suốt bước này, **đếm** số lần gọi và
   ghi lại `filters` nhận được; trả về `[vscode.Uri.file(...)]`. Khôi phục trong
   `finally`.
3. `sendStep({ op: "pickImageFromFile" })`, rồi **chờ thứ được khẳng định**: chuỗi
   markdown trong `document.getText()` (hai bước: debounce 300 ms của webview,
   rồi edit của host).

**Runner (`run.mjs`)** — đặt con trỏ, bấm nút toolbar, poll tới khi node xuất hiện:

```js
// harness/vscode-floor/run.mjs:3382 (trích bằng sed)
      } else if (cmd.op === "pickImageFromFile") {
```

Các khẳng định (mọi cái đều phải đúng):

```ts
// harness/vscode-floor/extension-tests.ts:1229 (trích bằng sed)
      const domOk =
        Boolean(pickRes?.ok) &&
        pickRes?.before === 0 &&
        pickRes?.after === 1 &&
        pickRes?.isWebviewUri === true &&
        pickRes?.notDataUri === true;

      record(
        PICK_NAME,
        oneDialog && imageFilter && savedRelative === "images/Picked Photo.png" && onDisk && domOk,
```

- `dialogs === 1` và `filters` chứa `Images` + `png`;
- file đích tồn tại trên đĩa (đường dẫn **lấy ra từ** chính chuỗi markdown trong
  tài liệu, không viết cứng);
- chuỗi markdown khớp `!\[Picked Photo\]\(<(images/[^>]+)>\)` **và** đường dẫn
  bắt được phải đúng bằng `images/Picked Photo.png` — nên bản `![Picked
  Photo](images/Picked Photo.png)` không bọc `<...>` là đỏ;
- DOM: `img[alt="Picked Photo"]` đi từ 0 lên 1, `src` là webview URI, **không**
  phải `data:` (base64 đi vòng qua webview là đúng thứ #173 sinh ra để tránh).

## 4. Check #174 (`pasteRemoteHtml`), hai pha

**Stub `globalThis.fetch`**: chỉ hai URL sentinel được trả lời, mọi URL khác đi
tiếp fetch thật:

```ts
// harness/vscode-floor/extension-tests.ts (đoạn defineProperty, trích bằng sed)
        Object.defineProperty(globalThis, "fetch", {
          value: async (input: any, init?: any) => {
            const url = typeof input === "string" ? input : String(input?.url ?? input);
            if (url === OK_URL || url === FAIL_URL) {
              fetched.push(url);
```

`Object.defineProperty` chứ không phải gán thẳng: runtime của host cài `fetch`
dưới dạng accessor, và phép gán vào thuộc tính chỉ có getter sẽ ném
`TypeError` trong strict mode mà module này chạy. Descriptor cũ được giữ lại và
khôi phục trong `finally` (xoá hẳn nếu trước đó không có).

1. **Pha 1 — setting TẮT (nửa bảo mật, bắt buộc).** `downloadRemoteImagesOnPaste`
   đặt `false` ở workspace scope. Paste `<p><img src="https://floor-remote.test/ok.png"
   alt="r1"></p>`. Khẳng định: **`fetch` được gọi 0 lần**, và tài liệu vẫn giữ
   `![r1](https://floor-remote.test/ok.png)`.
2. **Pha 2 — setting BẬT.** Khôi phục tài liệu, bật setting, paste
   `<p><img src="<ok>" alt="r2ok"><img src="<fail>" alt="r2bad"></p>`. Khẳng định:
   **đúng 2 lần fetch** (đúng hai sentinel, không URL nào khác), `r2ok` được thay
   bằng đường dẫn cục bộ khớp `images/image-*.png` **có thật trên đĩa**, và
   `r2bad` (403) **giữ nguyên** URL remote.

```ts
// harness/vscode-floor/extension-tests.ts:1382 (trích bằng sed)
        record(
          REMOTE_NAME,
          phase1.fetches === 0 &&
            phase1.keptRemote &&
            phase1.present &&
            phase1.stillRemote &&
            phase2.fetches === 2 &&
            phase2.okFetched &&
            phase2.failFetched &&
            /^images\/image-.+\.png$/.test(phase2.localPath) &&
            phase2.localOnDisk &&
            phase2.keptFailed &&
            phase2.present &&
            phase2.restoredClean,
```

`restoredClean` đọc **byte trên đĩa** sau khi khôi phục, không đọc model trong bộ
nhớ: model có thể còn giữ phiên bản đã lưu lúc đi ra, và pha 2 đọc cái đó thì
không chứng minh gì về pha 1.

Paste được dispatch bằng một `ClipboardEvent` thật mang `text/html`; `run.mjs`
chỉ nhận `ok/present/stillRemote/imgCount/httpsImgs`, còn mọi khẳng định về tài
liệu và về fetch đều ở host.

## 5. Chỗ đặc tả (mục 6 của `w11-image-insert.md`) LỆCH với code — code thắng

| # | Đặc tả nói | Code thật là gì | Ta làm gì |
|---|-----------|-----------------|-----------|
| 1 | `src` phải bắt đầu bằng `https://file+.vscode-resource.vscode-cdn.net/` | Trên 1.85 nó là `https://file%2B.vscode-resource.vscode-cdn.net/...` (dấu `+` bị percent-encode) — đọc được từ log: `imgSrc="md-floor-pkzxjc/ws/images/Picked%20Photo.png"`. Chuỗi `file+` viết cứng sẽ đỏ ngay với code đúng | Khớp `/vscode-resource\.vscode-cdn\.net|vscode-webview/` |
| 2 | `ok.png` được ghi vào `images/` và `![r2](images/...)` | `remoteImageFilename` đặt tên `image-<Date.now()>-<random>.<ext>` (bảo vệ thời điểm có 2 ảnh trùng tên), KHÔNG phải `ok.png` | Khớp `/^images\/image-.+\.png$/` và kiểm tra file đó có trên đĩa |
| 3 | Stub `globalThis.fetch` | `remote-fetch.ts` đọc `options.fetchImpl ?? fetch` **tại lúc gọi**, nên stub trên global là thấy được — chứng minh bằng `fetches=2` và ảnh `ok` đã được ghi | Dùng `Object.defineProperty` vì `fetch` là accessor (xem mục 4) |
| 4 | "Khi setting mặc định (`false`)" | `getDownloadRemoteImagesOnPaste` đọc setting **tại thời điểm paste**, không cache, và mặc định là `false` | Đặt tường minh `false` ở workspace scope rồi khôi phục `workspaceValue` cũ trong `finally`, để pha 1 không phụ thuộc mặc định |
| 5 | Bấm `/file` trong slash menu | Có cả hai đường (`TOOLBAR_COMMANDS.imageFromFile` → `requestImagePick`); toolbar là đường ngắn và không phụ thuộc bộ lọc của menu | Dùng nút toolbar `.toolbar-btn[data-command="imageFromFile"]` |
| 6 | Stub hoàn nguyên "afterwards" | — | Cả hai stub (`showOpenDialog`, `fetch`) đều nằm trong `finally`, và descriptor cũ của `fetch` được khôi phục đúng hình thức |

Một điểm đặc tả **không** nói nhưng cần: sau khi ghép, phải khôi phục **tài liệu**
nữa. `restoreSample` làm việc đó (mục 2.3), và nó xóa luôn `picker-source/` cùng
các file `images/Picked Photo*.png` / `images/image-*.png` mà hai check tạo ra, để
`runDiffEditorCheck`, `runDefaultEditorAssociationCheck` và
`runSchemeAssociationCheck` chạy sau thấy đúng sample ban đầu.

## 6. Chứng minh có răng (teeth)

Bốn lần sửa CÀN — đúng file mang cơ chế, đúng chỗ — mỗi lần một kiểm floor rồi
`git checkout --` khôi phục. Không có sửa cành nào được commit.

Lệnh (giống nhau cho cả 4 lần):

```
PUPPETEER_EXECUTABLE_PATH=$HOME/.cache/puppeteer-floor/chrome-nosandbox \
  timeout 900 xvfb-run -a -s "-screen 0 1920x1080x24" npm run verify:vscode-floor
```

### Răng A — bỏ `wrapMarkdownDestination` ở đường ghi (đường `#...>` của #173)

Sửa cành (`src/webview/image-path-translation.ts:125`):
`\`![${alt}](${wrapMarkdownDestination(replacement)}${rest})\`` →
`\`![${alt}](${replacement}${rest})\``

```
$ grep -c "^FAIL" /tmp/opencode/floor-toothA.log
1
$ grep -n "^FAIL" /tmp/opencode/floor-toothA.log
52:FAIL  insert image from file picker writes the file and inserts the relative link at the caret (#173) — dialogs=1 filters={"Images":["png","jpg","jpeg","gif","webp","svg","bmp","avif"]} saved="" onDisk=false dom(before=0,after=1,caret="P:",webviewUri=true,notData=true) imgSrc="md-floor-OBBnxk/ws/images/Picked%20Photo.png"
```

**1 ca đỏ, đúng check #173** (`saved=""`: regex bắt buộc `<...>` không khớp).

### Răng B — `pickImage` không còn trả lời (nửa host của #173)

Sửa cành (`src/host/messageHandlers.ts`): thân handler thành
`pickImage: (_msg, _ctx) => { /* TEETH: never answers */ },`

```
$ grep -c "^FAIL" /tmp/opencode/floor-toothB.log
1
$ grep -n "^FAIL" /tmp/opencode/floor-toothB.log
52:FAIL  insert image from file picker writes the file and inserts the relative link at the caret (#173) — dialogs=0 filters= saved="" onDisk=false dom(before=0,after=0,caret="P:",webviewUri=false,notData=true) imgSrc=""
```

**1 ca đỏ, đúng check #173** (`dialogs=0`, không node trong DOM, không link).

### Răng C — bỏ cổng opt-in của #174 (nửa bảo mật)

Sửa cành (`src/host/downloadRemoteImages.ts`): xoá dòng
`if (!deps.isEnabled(document)) return;`

```
$ grep -c "^FAIL" /tmp/opencode/floor-toothC.log
1
$ grep -n "^FAIL" /tmp/opencode/floor-toothC.log
53:FAIL  pasting HTML with https images respects downloadRemoteImagesOnPaste (#174) — off(fetches=1,keptRemote=false,nodeInDom=true,caret="P:") on(fetches=2,local="images/image-1792338820861-hhgrrr.png",onDisk=true,keptFailed=true,nodeInDom=true,caret="P:<img src=\"https://file%2B.vscode-resource.vscode-cdn.net/tmp",restoredClean=true,httpsImgs=5/8) urls=[https://floor-remote.test/ok.png https://floor-remote.test/ok.png https://floor-remote.test/fail.png]
```

**1 ca đỏ, đúng check #174** (`off(fetches=1)`: setting tắt mà vẫn gọi mạng.

### Răng D — bỏ `replaceRemoteImageSrc` (nửa webview của #174)

Sửa cành (`src/webview/main.ts:1988`): `replaceRemoteImageSrc(editor, img.url,
webviewUri);` → `void img; void webviewUri;`

```
$ grep -c "^FAIL" /tmp/opencode/floor-toothD.log
1
$ grep -n "^FAIL" /tmp/opencode/floor-toothD.log
53:FAIL  pasting HTML with https images respects downloadRemoteImagesOnPaste (#174) — off(fetches=0,keptRemote=true,nodeInDom=true,caret="P:") on(fetches=2,local="",onDisk=false,keptFailed=true,nodeInDom=true,caret="P:<img src=\"https://file%2B.vscode-resource.vscode-cdn.net/tmp",restoredClean=true,httpsImgs=5/8) urls=[https://floor-remote.test/ok.png https://floor-remote.test/fail.png]
```

**1 ca đỏ, đúng check #174** (`local=""`: ảnh tải về có trên đĩa nhưng node không
đổi, nên tài liệu không có đường dẫn cục bộ).

**Tổng: 4 lần chạy răng, 4 ca đỏ, mỗi lần đúng MỘT ca và đúng check của nó.**
Không có ca đỏ nào ở 69 check cũ.

### 6.1. Một số đọc lạ trong log, đã truy đến tận cùng

`caret="P:<img src=\"https://file%2B.vscode-resource.vscode-cdn.net/tmp"` ở pha 2
lúc đầu làm tôi nghi ngờ rò `vscode-resource` (hình dạng #142). Đã truy: đó là
**DOM**, không phải file. `transformForDisplay` dùng chung `replaceImagePaths`
với đường ghi, mà `replaceImagePaths` cũng thay `<img ... src="...">` bên trong
HTML thô; `sample.md` có sẵn một dòng `<img src="media/icon.png" width="96"
alt="A sized image">` render thành badge HTML thô, nên text của nó hiện webview
URI. Bằng chứng nó không chạm tới file: check sẵn có
`double-click rename leaves every reference on the new relative path (#142)`
vẫn xanh trong **cùng lượt đó**, và nó khẳng định `webviewUrls === 0` trong
`document.getText()`. Đây là hành vi hiển thị, không phải rò.

## 7. Kết quả trước khi kết thúc

### 7.1. `npm run lint` và `npm run build`

```
$ npm run lint
> tui-milkdown-vscode@3.4.2 lint
> tsc --noEmit
(no output = sạch)

$ npm run build
> tui-milkdown-vscode@3.4.2 build
> node esbuild.config.js

Building (production)...
Build complete (production)
webview bundle: 1035518 B / 1100000 B budget
```

### 7.2. `npm test`

```
$ npm test
ℹ tests 263
ℹ suites 57
ℹ pass 263
ℹ fail 0
```

### 7.3. `npm run roundtrip` (vòng 1)

```
$ npm run roundtrip
corpus: 46 fixtures (41 synthetic, 5 repo docs)
46 markdown fixtures + 21 seams: 67 passed, 0 failed, 0 missing, 0 errored
```

(67 chứ không phải 66 của `COMMON.md` vì W4 đã thêm 1 fixture + 1 seam kèm theo
#173/#174; không phải do lượt này.)

### 7.4. Vòng hai và bước khôi phục

```
$ cp harness/golden/synthetic/*.md harness/fixtures/synthetic/ && npm run roundtrip
46 markdown fixtures + 21 seams: 67 passed, 0 failed, 0 missing, 0 errored
$ git checkout -- harness/fixtures/synthetic/
$ git status --short harness/
(rỗng)
```

### 7.5. Không sửa fixture cũ

```
$ MB=$(git merge-base develop HEAD); git diff $MB..HEAD --stat -- harness/fixtures/synthetic/
(rỗng)
```

### 7.6. VS Code floor check

```
$ PUPPETEER_EXECUTABLE_PATH=$HOME/.cache/puppeteer-floor/chrome-nosandbox \
    xvfb-run -a -s "-screen 0 1920x1080x24" npm run verify:vscode-floor
EXIT=0
PASS  insert image from file picker writes the file and inserts the relative link at the caret (#173) — dialogs=1 filters={"Images":["png","jpg","jpeg","gif","webp","svg","bmp","avif"]} saved="images/Picked Photo.png" onDisk=true dom(before=0,after=1,caret="P:",webviewUri=true,notData=true) imgSrc="md-floor-pkzxjc/ws/images/Picked%20Photo.png"
PASS  pasting HTML with https images respects downloadRemoteImagesOnPaste (#174) — off(fetches=0,keptRemote=true,nodeInDom=true,caret="P:") on(fetches=2,local="images/image-1792339278485-k0kp6e.png",onDisk=true,keptFailed=true,nodeInDom=true,caret="P:<img src=\"https://file%2B.vscode-resource.vscode-cdn.net/tmp",restoredClean=true,httpsImgs=5/8) urls=[https://floor-remote.test/ok.png https://floor-remote.test/fail.png]

71 checks: 71 passed, 0 failed
```

**71 = 69 + 2**, đúng như TASK.md yêu cầu. Mốc 69/69 đã đo lại ở đầu lượt trước
khi sửa gì (xem mục 8).

### 7.7. `git status --short` và tiến trình sót

```
$ git status --short
(rỗng)
$ pkill -9 -f "extensionDevelopmentPath=$(pwd)"
(đã chạy sau mỗi lượt floor)
```

## 8. Mốc đo trước khi sửa

Đúng như `COMMON.md` ghi, chạy lại floor trên `develop` ở đầu lượt:

```
$ tail -1 /tmp/opencode/floor-baseline.log
69 checks: 69 passed, 0 failed
```

Không có con số nào lệch trước khi tôi sửa gì.

## 9. Tiêu chí CHƯA kiểm được

- **Dialog thật.** `showOpenDialog` bị bọc, nên check này không chứng minh VS Code
  mở được hộp thoại native, cũng không kiểm tra `defaultUri`/`openLabel`. Nó
  chứng minh phần còn lại: message đi qua handler, `filters` đúng, byte đọc bằng
  `workspace.fs`, `writeImage` ghi đúng chỗ, và webview cắm vào đúng con trỏ.
- **`response.ok` thật của fetch.** Stub trả `Response` dựng bằng tay nên
  `res.url` rỗng, tức nhánh "redirect ra khỏi https" của `remote-fetch.ts` không
  được đi tới. Nhánh đó thuộc `remote-fetch.ts`, đã có unit test riêng.
- **Caret sau khi dialog mở lâu.** `ImageInsertAnchors` (ánh xạ vị trí qua mọi
  transaction trong lúc dialog mở) không được đo ở đây: stub trả về ngay lập
  tức, không có cửa sổ thời gian để gõ vào. Seam `harness/image-insert-seam.ts`
  của W4 là nơi đo việc đó.

## 10. Câu chữ đề xuất cho tài liệu gốc

Lượt này **không thêm tính năng, không thêm file nguồn, không thêm quy ước**. Nên
`CHANGELOG.md` và `README.md` không có gì để thêm; mục này để trống có chủ ý.

Riêng `AGENTS.md`: mục **File Structure** đã ghi `harness/vscode-floor/  #
VS Code floor check: run.mjs (driver + surface probes) + extension-tests.ts
(in-host checks)`, vẫn đúng sau lượt này. Không đề xuất sửa.

Nếu điều phối viên vẫn muốn một dòng ghi nhận vòng 2, câu này là đúng đắn (tự
viết, chưa áp dụng vì ràng buộc 1 của `COMMON.md` cấm sửa `.md` ở gốc repo):

```markdown
- Wave 11 added the #171/#172/#177/#178 checks and then #173/#174's: the file
  picker and the opt-in remote download can only be driven through the
  extension host (`showOpenDialog` and `globalThis.fetch` are stubbed there for
  the phase and restored afterwards), while the caret and the paste go through
  `clickTopLevelParagraph` and a real `ClipboardEvent` over CDP
```

## 11. Đặc tả floor check đề xuất

Hai check mục 6 là thứ lượt này cài, nên phần "đề xuất" trống. Một điều đáng cân
nhắc cho lượt sau, **không** thuộc phạm vi lượt này (cần sửa `run.mjs` ngoài
phần đã giao): `clickTopLevelParagraph` hiện chọn paragraph đầu tiên **đang nhìn
thấy**, nên nó phụ thuộc vị trí cuộn được khôi phục và không hoàn toàn tất định
giữa các lượt. Nếu một check sau nào cần con trỏ ở đúng một paragraph, hãy
chọn theo **nội dung** (`p.textContent.includes(...)`) thay vì theo thứ tự.

## 12. Ghi chú cho lượt sau

- `driveWave11Checks` **không** có biến `session` (khác `driveSurfaces`); lấy
  session qua `findWebviewByHeading(...).session`.
- Hai check mới để lại `picker-source/` và `images/image-*.png` nếu bạn thêm một
  bước 5 vào `runWave11FloorChecks`: hãy dùng `restoreSample` chứ không dùng
  `d.save()`.
- Mốc đo của lượt này: floor **71 checks**, `npm test` **263**, roundtrip **67**.