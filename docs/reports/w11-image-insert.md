# Báo cáo Sóng 11 — W4: Chèn ảnh bằng hộp chọn file (#173) và tải ảnh remote khi paste (#174)

Nhánh: `wave11/w4-image-insert`
Merge-base với `develop`: `f2bd057`

## 1. Tóm tắt thay đổi và cấu trúc

### Danh sách file thay đổi (sinh bằng `git diff --stat`)

Lệnh:
```sh
git diff --stat f2bd057..HEAD
```

Output:
```text
 harness/golden/seams/image-insert.txt |  48 +++++-
 harness/golden/seams/slash.txt        |   1 +
 harness/image-insert-seam.ts          | 276 +++++++++++++++++++++++++++++++++-
 package.json                          |   5 +
 src/host/config.ts                    |  13 ++
 src/host/downloadRemoteImages.ts      | 158 +++++++++++++++++++
 src/host/messageHandlers.ts           |  15 ++
 src/host/pickImage.ts                 | 172 +++++++++++++++++++++
 src/markdownEditorProvider.ts         |   3 +
 src/shared/messages.ts                |  47 +++++-
 src/utils/export-docx.ts              |  29 +---
 src/utils/remote-fetch.ts             | 118 +++++++++++++++
 src/webview/image-insert.ts           | 147 ++++++++++++++++++
 src/webview/image-path-translation.ts |  18 ++-
 src/webview/main.ts                   |  76 +++++++++-
 src/webview/slash-command-plugin.ts   |  30 +++-
 test/download-remote-images.test.ts   | 183 ++++++++++++++++++++++
 test/pick-image.test.ts               | 145 ++++++++++++++++++
 test/remote-fetch.test.ts             | 129 ++++++++++++++++
 19 files changed, 1576 insertions(+), 37 deletions(-)
```

### Danh sách hàm, hằng và kiểu export mới (sinh bằng `git grep`)

Lệnh:
```sh
git grep -n "^export " src/utils/remote-fetch.ts src/host/pickImage.ts src/host/downloadRemoteImages.ts src/host/config.ts src/webview/image-insert.ts
```

Output:
```text
src/host/config.ts:50:export function getDownloadRemoteImagesOnPaste(
src/host/config.ts:118:export function buildConfigMessage(document: vscode.TextDocument): ConfigMessage {
src/host/config.ts:137:export function handleConfigurationChange(
src/host/downloadRemoteImages.ts:32:export const MAX_REMOTE_IMAGES_PER_PASTE = 50;
src/host/downloadRemoteImages.ts:47:export interface DownloadRemoteImagesDeps {
src/host/downloadRemoteImages.ts:69:export function selectDownloadableUrls(urls: unknown): string[] {
src/host/downloadRemoteImages.ts:88:export function remoteImageFilename(
src/host/downloadRemoteImages.ts:97:export async function handleDownloadRemoteImages(
src/host/pickImage.ts:27:export const IMAGE_FILE_EXTENSIONS = [
src/host/pickImage.ts:39:export const PICKED_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
src/host/pickImage.ts:41:export interface PickImageDeps {
src/host/pickImage.ts:81:export function pickedImageNames(
src/host/pickImage.ts:99:export async function handlePickImage(
src/utils/remote-fetch.ts:20:export const REMOTE_FETCH_TIMEOUT_MS = 30_000;
src/utils/remote-fetch.ts:21:export const REMOTE_MAX_BYTES = 10 * 1024 * 1024; // 10MB
src/utils/remote-fetch.ts:23:export interface RemoteFetchOptions {
src/utils/remote-fetch.ts:39:export interface RemoteFetchResult {
src/utils/remote-fetch.ts:83:export async function fetchRemoteBytes(
src/webview/image-insert.ts:33:export const ImageInsertAnchors = Extension.create({
src/webview/image-insert.ts:64:export function recordInsertAnchor(editor: Editor): string {
src/webview/image-insert.ts:74:export function takeInsertAnchor(editor: Editor, id: string): number | null {
src/webview/image-insert.ts:90:export function insertImageAt(
src/webview/image-insert.ts:111:export function replaceRemoteImageSrc(
src/webview/image-insert.ts:135:export function collectRemoteImageUrls(html: string): string[] {
```

### Danh sách message mới trong giao thức (sinh bằng `git grep`)

Lệnh:
```sh
git grep -n "PickImageMessage\|DownloadRemoteImagesMessage\|ImagePickedMessage\|RemoteImagesDownloadedMessage\|pickImage\|downloadRemoteImages\|imagePicked\|remoteImagesDownloaded" src/shared/messages.ts src/host/messageHandlers.ts src/webview/main.ts
```

Output:
```text
src/host/messageHandlers.ts:41:import { handlePickImage } from "./pickImage";
src/host/messageHandlers.ts:42:import { handleDownloadRemoteImages } from "./downloadRemoteImages";
src/host/messageHandlers.ts:272:  // likes and must not hold up the next message. It answers with `imagePicked`
src/host/messageHandlers.ts:274:  pickImage: (msg, ctx) => {
src/host/messageHandlers.ts:280:  downloadRemoteImages: (msg, ctx) => {
src/shared/messages.ts:109: * reply (`imagePicked`) carries it back. The file's bytes never travel through
src/shared/messages.ts:112:export interface PickImageMessage {
src/shared/messages.ts:113:  type: "pickImage";
src/shared/messages.ts:119: * only when `tuiMarkdown.downloadRemoteImagesOnPaste` is on; with it off the
src/shared/messages.ts:122:export interface DownloadRemoteImagesMessage {
src/shared/messages.ts:123:  type: "downloadRemoteImages";
src/shared/messages.ts:147:  | PickImageMessage
src/shared/messages.ts:148:  | DownloadRemoteImagesMessage;
src/shared/messages.ts:254: * Reply to `pickImage`. No `savedPath` means nothing was inserted (dialog
src/shared/messages.ts:258:export interface ImagePickedMessage {
src/shared/messages.ts:259:  type: "imagePicked";
src/shared/messages.ts:266:/** Reply to `downloadRemoteImages`: only the images that were downloaded and saved. */
src/shared/messages.ts:267:export interface RemoteImagesDownloadedMessage {
src/shared/messages.ts:268:  type: "remoteImagesDownloaded";
src/shared/messages.ts:288:  | ImagePickedMessage
src/shared/messages.ts:289:  | RemoteImagesDownloadedMessage;
src/webview/main.ts:262:  vscode.postMessage({ type: "pickImage", requestId });
src/webview/main.ts:914:                vscode.postMessage({ type: "downloadRemoteImages", urls });
src/webview/main.ts:1855:    case "imagePicked":
src/webview/main.ts:1873:    case "remoteImagesDownloaded":
```

---

## 2. Chi tiết cơ chế và mã nguồn thực tế

### 2.1. Tách module tải ảnh remote có giới hạn (`src/utils/remote-fetch.ts`) và dùng chung với DOCX export

`fetchRemoteBytes` kiểm tra cả `content-length` khai báo lẫn số byte thực đọc qua stream (`readCapped`), hủy request bằng `AbortController` ngay khi vượt `maxBytes` hoặc quá `timeoutMs`, đồng thời hỗ trợ `httpsOnly` (kiểm tra cả URL đầu vào lẫn `res.url` sau redirect) và `requireImageContentType`.

Lệnh:
```sh
sed -n '82,116p' src/utils/remote-fetch.ts
```

Output:
```ts

export async function fetchRemoteBytes(
  url: string,
  options: RemoteFetchOptions = {},
): Promise<RemoteFetchResult> {
  const maxBytes = options.maxBytes ?? REMOTE_MAX_BYTES;
  const doFetch = options.fetchImpl ?? fetch;

  if (options.httpsOnly && !/^https:\/\//i.test(url)) {
    throw new Error(`Only https: URLs are downloaded: ${url}`);
  }

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? REMOTE_FETCH_TIMEOUT_MS,
  );
  try {
    const res = await doFetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Fetch ${res.status} for ${url}`);
    if (options.httpsOnly && res.url && !/^https:\/\//i.test(res.url)) {
      throw new Error(`Redirected away from https: ${url}`);
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (options.requireImageContentType && !/^image\//i.test(contentType)) {
      throw new Error(`Not an image (${contentType || "no content-type"}): ${url}`);
    }
    const declaredSize = Number(res.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredSize) && declaredSize > maxBytes) {
      throw tooLarge(url, maxBytes);
    }
    const bytes = await readCapped(res, url, maxBytes, controller);
    return { bytes, contentType };
  } finally {
    clearTimeout(timer);
```

Điểm gọi trong `src/utils/export-docx.ts`:

Lệnh:
```sh
sed -n '430,436p' src/utils/export-docx.ts
```

Output:
```ts
      } else if (/^https?:\/\//i.test(src)) {
        const remote = await fetchRemoteBytes(src);
        buffer = Buffer.from(remote.bytes);
        const ext = remote.contentType.split("/")[1]?.split(";")[0] ?? "png";
        type = normalizeImageType(ext);
        dataForDocx = buffer;
      } else {
```

### 2.2. Host handler `#173` (`src/host/pickImage.ts`) và tương thích với `writeImage` trên `develop`

- `handlePickImage` mở `vscode.window.showOpenDialog` với bộ lọc `IMAGE_FILE_EXTENSIONS`, kiểm tra kích thước qua `vscode.workspace.fs.stat`, đọc byte bằng `vscode.workspace.fs.readFile` ngay trên host, và ghi qua `writeImage(document, names.filename, bytes)`. Không có dữ liệu base64 nào đi qua webview.
- `pickedImageNames` làm sạch tên gốc (thay ký tự cấm trên Windows, chặn `..`, thêm tiền tố `_` cho tên thiết bị Windows như `CON.png`) và giữ nguyên stem sạch làm tên gợi ý cho `writeImage`. Khi ghép với `writeImage` trên `develop` (vốn mở rộng `tuiMarkdown.imageFileNameTemplate` mặc định `${name}`, sửa phần mở rộng theo magic bytes và tự thêm `-2`, `-3` khi trùng tên), `handlePickImage` luôn lấy `saved.relativePath` và `saved.fileUri` do `writeImage` trả về.
- Mọi nhánh thoát (huỷ dialog, file quá lớn, sai đuôi, `writeImage` trả `undefined`, lỗi đọc file) đều gửi `imagePicked` không kèm `savedPath` để webview giải phóng neo vị trí.

Lệnh:
```sh
sed -n '80,164p' src/host/pickImage.ts
```

Output:
```ts
 */
export function pickedImageNames(
  originalName: string,
): { alt: string; filename: string } | undefined {
  const dot = originalName.lastIndexOf(".");
  const ext = dot > 0 ? originalName.slice(dot + 1).toLowerCase() : "";
  if (!IMAGE_FILE_EXTENSIONS.includes(ext)) return undefined;
  const rawStem = originalName.slice(0, dot);
  const stem = rawStem
    .replace(/[<>:"|?*\\/\x00-\x1F\u202E]/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/[. ]+$/, "")
    .trim()
    .slice(0, 80);
  let safeStem = stem && stem !== "." ? stem : "image";
  if (RESERVED_NAMES.test(safeStem)) safeStem = `_${safeStem}`;
  return { alt: safeStem, filename: `${safeStem}.${ext}` };
}

export async function handlePickImage(
  msg: PickImageMessage,
  document: vscode.TextDocument,
  webview: TypedWebview,
  deps: PickImageDeps = defaultDeps,
): Promise<void> {
  const requestId = msg.requestId;
  const reply = (picked: {
    savedPath?: string;
    webviewUri?: string;
    alt?: string;
  }) => {
    try {
      void webview.postMessage({ type: "imagePicked", requestId, ...picked });
    } catch {
      /* webview disposed while the dialog was open */
    }
  };

  try {
    const uris = await deps.showOpenDialog({
      canSelectMany: false,
      canSelectFiles: true,
      canSelectFolders: false,
      openLabel: "Insert Image",
      title: "Insert image from file",
      defaultUri: vscode.Uri.joinPath(document.uri, ".."),
      filters: { Images: IMAGE_FILE_EXTENSIONS },
    });
    const picked = uris?.[0];
    if (!picked) {
      reply({});
      return;
    }

    const names = pickedImageNames(baseName(picked.path));
    if (!names) {
      deps.showWarningMessage(
        `Not a supported image file: ${baseName(picked.path)}`,
      );
      reply({});
      return;
    }

    const { size } = await deps.stat(picked);
    if (size > PICKED_IMAGE_MAX_BYTES) {
      deps.showWarningMessage(
        `Image too large (${(size / 1024 / 1024).toFixed(1)}MB). Maximum is ${PICKED_IMAGE_MAX_BYTES / 1024 / 1024}MB.`,
      );
      reply({});
      return;
    }

    const bytes = await deps.readFile(picked);
    const saved = await deps.writeImage(document, names.filename, bytes);
    if (!saved) {
      // writeImage has already told the user why.
      reply({});
      return;
    }

    reply({
      savedPath: saved.relativePath,
      webviewUri: webview.asWebviewUri(saved.fileUri).toString(),
      alt: names.alt,
    });
```

### 2.3. Giữ vị trí con trỏ khi hộp chọn file bất đồng bộ (`src/webview/image-insert.ts`)

Khi người dùng kích hoạt "Image from file…" (từ slash menu hoặc nút toolbar), `requestImagePick` gọi `recordInsertAnchor(editor)`:
1. `recordInsertAnchor` đọc `editor.state.selection.from` tại thời điểm mở dialog và dispatch một transaction mang metadata `{ add: { id, pos } }` vào plugin `ImageInsertAnchors`.
2. Trong khi hộp chọn file đang mở, nếu tài liệu có bất kỳ transaction nào làm thay đổi nội dung (`tr.docChanged`), hàm `apply` của plugin `ImageInsertAnchors` cập nhật mọi vị trí đang lưu qua `tr.mapping.map(pos)`. Nhờ đó vị trí chèn dịch chuyển theo đúng văn bản xung quanh.
3. Khi host trả về `imagePicked`, webview luôn gọi `takeInsertAnchor(editor, message.requestId)` để lấy vị trí đã map và xóa `requestId` khỏi plugin state (kể cả khi huỷ dialog, tránh rò rỉ anchor), rồi chèn node ảnh bằng transaction qua `insertImageAt`.
4. Trong `src/webview/image-insert.ts`, `replaceRemoteImageSrc` thay thế `src` của các node `image` khớp chính xác URL remote bằng một ProseMirror transaction (`tr.setNodeMarkup`), và `collectRemoteImageUrls` phân tích HTML paste thông qua `<template>` (inert fragment, không tự phát sinh request mạng) để trích xuất danh sách URL `https:` duy nhất.

Lệnh:
```sh
sed -n '25,130p' src/webview/image-insert.ts
```

Output:
```ts
const anchorsKey = new PluginKey<Map<string, number>>("imageInsertAnchors");

type AnchorMeta = { add?: { id: string; pos: number }; remove?: string };

/**
 * UI plumbing only: it changes no schema and no markdown, so each caller adds
 * it next to the other UI extensions (main.ts) rather than the factory.
 */
export const ImageInsertAnchors = Extension.create({
  name: "imageInsertAnchors",
  addProseMirrorPlugins() {
    return [
      new Plugin<Map<string, number>>({
        key: anchorsKey,
        state: {
          init: () => new Map(),
          apply(tr, anchors) {
            const meta = tr.getMeta(anchorsKey) as AnchorMeta | undefined;
            if (!tr.docChanged && !meta) return anchors;
            const next = new Map<string, number>();
            for (const [id, pos] of anchors) {
              if (meta?.remove === id) continue;
              next.set(id, tr.mapping.map(pos));
            }
            if (meta?.add) next.set(meta.add.id, meta.add.pos);
            return next;
          },
        },
      }),
    ];
  },
});

let requestCounter = 0;

/**
 * Remember the current cursor under a fresh request id and return the id. The
 * caller sends it to the host and gets it back in the reply.
 */
export function recordInsertAnchor(editor: Editor): string {
  const id = `pick-${Date.now()}-${++requestCounter}`;
  const pos = editor.state.selection.from;
  editor.view.dispatch(
    editor.state.tr.setMeta(anchorsKey, { add: { id, pos } } satisfies AnchorMeta),
  );
  return id;
}

/** The mapped position for `id`, forgetting it; `null` if there is none. */
export function takeInsertAnchor(editor: Editor, id: string): number | null {
  const anchors = anchorsKey.getState(editor.state);
  const pos = anchors?.get(id);
  if (pos === undefined) return null;
  editor.view.dispatch(
    editor.state.tr.setMeta(anchorsKey, { remove: id } satisfies AnchorMeta),
  );
  return pos;
}

/**
 * Insert an image node at `pos` (a position from `takeInsertAnchor`). `src` is
 * the DISPLAY url (the webview URI); the saved markdown gets the relative path
 * back through `transformForSave` because the caller put the pair in the image
 * map first.
 */
export function insertImageAt(
  editor: Editor,
  pos: number,
  attrs: { src: string; alt?: string },
): boolean {
  const clamped = Math.max(0, Math.min(pos, editor.state.doc.content.size));
  return editor
    .chain()
    .insertContentAt(clamped, {
      type: "image",
      attrs: { src: attrs.src, alt: attrs.alt ?? "" },
    })
    .focus()
    .run();
}

/**
 * Point every image node whose `src` is exactly `url` at `newSrc`, in one
 * transaction. Exact match, not `sameResource`: the source is a remote URL and
 * two distinct remote URLs must never be treated as one file.
 */
export function replaceRemoteImageSrc(
  editor: Editor,
  url: string,
  newSrc: string,
): number {
  const { state } = editor;
  const tr = state.tr;
  let count = 0;
  state.doc.descendants((node, pos) => {
    if (node.type.name === "image" && node.attrs.src === url) {
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: newSrc });
      count++;
    }
  });
  if (count > 0) editor.view.dispatch(tr);
  return count;
}
```

### 2.4. Dịch đường dẫn ảnh có dấu cách (`src/webview/image-path-translation.ts`)

Khi ảnh được chọn từ file có dấu cách trong tên (vd `images/my photo.png`), `MarkdownImage.renderMarkdown` bọc đích trong `<...>` (`![my photo](<images/my photo.png>)`). Trước đây `replaceImagePaths` trong `src/webview/image-path-translation.ts` chỉ khớp `([^)\s]+)` và khi thay thế không gọi `wrapMarkdownDestination`, khiến:
- Lúc lưu (`transformForSave`): đường dẫn tương đối có dấu cách bị ghi trần `![my photo](images/my photo.png)` (hỏng cú pháp CommonMark).
- Lúc mở lại (`transformForDisplay`): `![my photo](<images/my photo.png>)` không khớp được key trong `imageMap`.

`replaceImagePaths` đã được cập nhật để nhận diện cả nhánh `<...>` lẫn nhánh trần và bọc lại kết quả bằng `wrapMarkdownDestination(replacement)`:

Lệnh:
```sh
sed -n '109,130p' src/webview/image-path-translation.ts
```

Output:
```ts
function replaceImagePaths(
  content: string,
  lookup: (url: string) => string | undefined,
): string {
  // Replace in markdown images: ![alt](url), ![alt](url "title") and the
  // angle-bracket form ![alt](<a path with spaces>). The bracketed form has to
  // be matched as its own alternative: `[^)\s]+` stops at the first space and
  // would look up `<images/my`, so a path with a space was never translated, and
  // on the way out the relative path was written back bare, which is not a
  // markdown destination (#173). The replacement is re-wrapped when it needs it.
  let result = content.replace(
    /!\[([^\]]*)\]\((?:<([^<>\n]*)>|([^)\s<][^)\s]*))([^)]*)\)/g,
    (match, alt, angled, bare, rest) => {
      const replacement = lookup(angled ?? bare);
      return replacement
        ? `![${alt}](${wrapMarkdownDestination(replacement)}${rest})`
        : match;
    }
  );
```

### 2.5. Host handler `#174` (`src/host/downloadRemoteImages.ts`) và setting `tuiMarkdown.downloadRemoteImagesOnPaste`

- Khi `getDownloadRemoteImagesOnPaste(document)` tắt (mặc định `false`), `handleDownloadRemoteImages` thoát ngay ở dòng đầu tiên trước khi chạm mạng.
- Chỉ nhận URL `https:`, giới hạn tối đa `MAX_REMOTE_IMAGES_PER_PASTE` (50) mỗi lần paste, tải song song tối đa 3 request qua `fetchRemoteBytes(url, { httpsOnly: true, requireImageContentType: true })`, lưu qua `writeImage(document, filename, bytes)` và dùng `saved.relativePath` + `saved.fileUri` do `writeImage` trả về.
- Ảnh tải lỗi (401/403/404, quá 10MB, timeout, không phải `image/*`, hoặc `writeImage` từ chối) được bắt lỗi riêng từng ảnh và giữ nguyên URL remote trong tài liệu.

Lệnh:
```sh
sed -n '97,158p' src/host/downloadRemoteImages.ts
```

Output:
```ts
export async function handleDownloadRemoteImages(
  msg: DownloadRemoteImagesMessage,
  document: vscode.TextDocument,
  webview: TypedWebview,
  deps: DownloadRemoteImagesDeps = defaultDeps,
): Promise<void> {
  // The gate comes before anything else, so "off" provably means "no request".
  if (!deps.isEnabled(document)) return;

  const urls = selectDownloadableUrls(msg.urls);
  if (urls.length === 0) return;

  let failed = 0;
  const queue = [...urls];

  const downloadOne = async (url: string): Promise<void> => {
    try {
      const { bytes, contentType } = await deps.fetchBytes(url);
      const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const filename = remoteImageFilename(contentType, unique);
      if (!filename) throw new Error(`Unsupported image type "${contentType}": ${url}`);
      const saved = await deps.writeImage(document, filename, bytes);
      if (!saved) {
        // writeImage has already reported why.
        failed++;
        return;
      }
      await webview.postMessage({
        type: "remoteImagesDownloaded",
        images: [
          {
            url,
            savedPath: saved.relativePath,
            webviewUri: webview.asWebviewUri(saved.fileUri).toString(),
          },
        ],
      });
    } catch (err) {
      failed++;
      console.warn(
        "[Remote Images] Kept remote URL:",
        url,
        err instanceof Error ? err.message : String(err),
      );
    }
  };

  const worker = async (): Promise<void> => {
    for (let url = queue.shift(); url !== undefined; url = queue.shift()) {
      await downloadOne(url);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, urls.length) }, worker),
  );

  if (failed > 0) {
    deps.setStatus(
      `${failed} of ${urls.length} pasted image${urls.length === 1 ? "" : "s"} could not be downloaded; the remote link${failed === 1 ? " was" : "s were"} kept.`,
    );
  }
}
```

### 2.6. Wiring trong webview (`src/webview/main.ts`, `src/webview/slash-command-plugin.ts`, `src/markdownEditorProvider.ts`)

Hook paste HTML và xử lý message trả về trong `src/webview/main.ts` (không bọc trong `guardExtensionUpdate`, để transaction đi qua luồng `onUpdate -> ContentSync.debouncedPostEdit -> postEdit` bình thường):

Lệnh:
```sh
sed -n '902,919p' src/webview/main.ts
```

Output:
```ts
      editorProps: {
        handlePaste(view, event) {
          const file = getImageFromClipboard(event.clipboardData);
          if (!file) {
            // #174: report the https images in pasted HTML. This never consumes
            // the paste (it returns false below, so the default HTML paste runs
            // and the nodes keep their remote src). The host decides whether
            // anything is downloaded; with the setting off it does nothing.
            const html = event.clipboardData?.getData("text/html");
            if (html) {
              const urls = collectRemoteImageUrls(html);
              if (urls.length > 0) {
                vscode.postMessage({ type: "downloadRemoteImages", urls });
              }
            }
            return false;
          }
          event.preventDefault();
```

Lệnh:
```sh
sed -n '1855,1892p' src/webview/main.ts
```

Output:
```ts
    case "imagePicked":
      if (typeof message.requestId === "string" && editor?.view) {
        // Always take the anchor, so a cancelled dialog does not leak it.
        const pos = takeInsertAnchor(editor, message.requestId);
        if (
          pos !== null &&
          typeof message.savedPath === "string" &&
          typeof message.webviewUri === "string"
        ) {
          const { savedPath, webviewUri } = message;
          mutateImageMap((map) => {
            map[savedPath] = webviewUri;
          });
          // An ordinary transaction: ContentSync posts the resulting edit.
          insertImageAt(editor, pos, { src: webviewUri, alt: message.alt });
        }
      }
      break;
    case "remoteImagesDownloaded":
      if (Array.isArray(message.images) && editor?.view) {
        for (const img of message.images) {
          if (
            typeof img.url !== "string" ||
            typeof img.savedPath !== "string" ||
            typeof img.webviewUri !== "string"
          ) {
            continue;
          }
          const { savedPath, webviewUri } = img;
          mutateImageMap((map) => {
            map[savedPath] = webviewUri;
          });
          // Not under guardExtensionUpdate: this IS a user-visible document
          // change, and it must reach the host through the normal edit path.
          replaceRemoteImageSrc(editor, img.url, webviewUri);
        }
      }
      break;
```

Mục slash menu `image-file` trong `src/webview/slash-command-plugin.ts`:

Lệnh:
```sh
sed -n '257,269p' src/webview/slash-command-plugin.ts
```

Output:
```ts
  {
    id: "image-file",
    title: "Image from file…",
    description: "Pick an image file and save it next to the document",
    keywords: ["image", "picture", "photo", "file", "upload", "browse", "pick", "img"],
    icon: `<svg ${SVG_ATTRS}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`,
    command: (editor, range) => {
      // Remove the typed `/` first, so the position recorded for the dialog is
      // where the image will go, not a position inside the slash query.
      editor.chain().focus().deleteRange(range).run();
      imagePickProvider?.(editor);
    },
  },
```

Nút toolbar trong `src/markdownEditorProvider.ts`:

Lệnh:
```sh
sed -n '303,309p' src/markdownEditorProvider.ts
```

Output:
```html
            <button class="toolbar-btn" data-command="link" title="Insert Link (Ctrl+K)" aria-label="Insert Link">
              <svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
            </button>
            <button class="toolbar-btn" data-command="imageFromFile" title="Insert Image from File" aria-label="Insert Image from File">
              <svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
            </button>
          </div>
```

---

## 3. Chứng minh có răng (Mutation / Teeth Verification)

### 3.1. Răng của bộ unit test (`test/remote-fetch.test.ts`, `test/pick-image.test.ts`, `test/download-remote-images.test.ts`)

19 đột biến độc lập trên `src/utils/remote-fetch.ts`, `src/host/downloadRemoteImages.ts` và `src/host/pickImage.ts`, mỗi đột biến chạy `npm test` rồi khôi phục bằng `git checkout -- <file>`:

Lệnh:
```sh
python3 - <<'EOF'
import subprocess, re
ROOT = "/home/tuanhv/.paseo/worktrees/3t05p45h/w11-image-insert"
def sh(cmd):
    return subprocess.run(cmd, shell=True, cwd=ROOT, capture_output=True, text=True, timeout=30).stdout
unit_mutations = [
    ("remote-fetch: declared content-length cap", "src/utils/remote-fetch.ts",
     "if (Number.isFinite(declaredSize) && declaredSize > maxBytes) {", "if (false) {"),
    ("remote-fetch: streaming body byte cap", "src/utils/remote-fetch.ts",
     "    if (total > maxBytes) {\n      controller.abort();", "    if (false) {\n      controller.abort();"),
    ("remote-fetch: httpsOnly initial URL check", "src/utils/remote-fetch.ts",
     "if (options.httpsOnly && !/^https:\\/\\//i.test(url)) {", "if (false) {"),
    ("remote-fetch: httpsOnly redirect URL check", "src/utils/remote-fetch.ts",
     "if (options.httpsOnly && res.url && !/^https:\\/\\//i.test(res.url)) {", "if (false) {"),
    ("remote-fetch: requireImageContentType check", "src/utils/remote-fetch.ts",
     "if (options.requireImageContentType && !/^image\\//i.test(contentType)) {", "if (false) {"),
    ("remote-fetch: abort timeout", "src/utils/remote-fetch.ts",
     "    options.timeoutMs ?? REMOTE_FETCH_TIMEOUT_MS,", "    1e9,"),
    ("downloadRemoteImages: opt-in setting gate", "src/host/downloadRemoteImages.ts",
     "  if (!deps.isEnabled(document)) return;", "  void deps.isEnabled;"),
    ("downloadRemoteImages: https-only URL filter", "src/host/downloadRemoteImages.ts",
     'if (parsed.protocol !== "https:") continue;', ""),
    ("downloadRemoteImages: per-image failure isolation", "src/host/downloadRemoteImages.ts",
     "    } catch (err) {\n      failed++;\n      console.warn(", "    } catch (err) {\n      throw err;\n      console.warn("),
    ("downloadRemoteImages: use writeImage returned relativePath", "src/host/downloadRemoteImages.ts",
     "            savedPath: saved.relativePath,", "            savedPath: `images/${filename}`,"),
    ("downloadRemoteImages: per-paste URL cap", "src/host/downloadRemoteImages.ts",
     "    if (out.length >= MAX_REMOTE_IMAGES_PER_PASTE) break;", ""),
    ("downloadRemoteImages: reject unknown image subtype", "src/host/downloadRemoteImages.ts",
     "  return ext ? `image-${unique}.${ext}` : undefined;", '  return `image-${unique}.${ext ?? "bin"}`;'),
    ("pickImage: reply on cancelled dialog", "src/host/pickImage.ts",
     "    if (!picked) {\n      reply({});\n      return;\n    }", "    if (!picked) {\n      return;\n    }"),
    ("pickImage: file size cap before readFile", "src/host/pickImage.ts",
     "    if (size > PICKED_IMAGE_MAX_BYTES) {", "    if (false) {"),
    ("pickImage: pass read bytes to writeImage", "src/host/pickImage.ts",
     "    const saved = await deps.writeImage(document, names.filename, bytes);", "    const saved = await deps.writeImage(document, names.filename, new Uint8Array(0));"),
    ("pickImage: use writeImage returned relativePath", "src/host/pickImage.ts",
     "      savedPath: saved.relativePath,", "      savedPath: `images/${names.filename}`,"),
    ("pickImage: sanitize invalid filename characters", "src/host/pickImage.ts",
     '    .replace(/[<>:"|?*\\\\/\\x00-\\x1F\\u202E]/g, "-")', ""),
    ("pickImage: prefix Windows reserved device names", "src/host/pickImage.ts",
     "  if (RESERVED_NAMES.test(safeStem)) safeStem = `_${safeStem}`;", ""),
    ("pickImage: reject non-image extension", "src/host/pickImage.ts",
     "  if (!IMAGE_FILE_EXTENSIONS.includes(ext)) return undefined;", ""),
]
for label, path, old, new in unit_mutations:
    p = ROOT + "/" + path
    s = open(p).read()
    open(p, "w").write(s.replace(old, new))
    try:
        out = sh("npm test 2>&1")
        fail_match = re.findall(r"ℹ fail (\d+)", out)
        pass_match = re.findall(r"ℹ pass (\d+)", out)
        failed_lines = [l.strip() for l in out.splitlines() if l.strip().startswith("✖") and not l.strip().startswith("✖ failing tests")]
        print(f"[UNIT] {label} ({path}): pass={pass_match[-1]} fail={fail_match[-1]} -> {failed_lines[0]}")
    finally:
        sh(f"git checkout -- {path}")
out = sh("npm test 2>&1")
print("RESTORED UNIT:", re.findall(r"ℹ (?:tests|pass|fail) \d+", out))
EOF
```

Output:
```text
[UNIT] remote-fetch: declared content-length cap (src/utils/remote-fetch.ts): pass=127 fail=1 -> ✖ rejects a declared content-length over the cap before reading the body (1.574967ms)
[UNIT] remote-fetch: streaming body byte cap (src/utils/remote-fetch.ts): pass=127 fail=1 -> ✖ rejects a body over the cap even when no length was declared (1.349427ms)
[UNIT] remote-fetch: httpsOnly initial URL check (src/utils/remote-fetch.ts): pass=127 fail=1 -> ✖ httpsOnly refuses an http: URL without calling fetch (1.690873ms)
[UNIT] remote-fetch: httpsOnly redirect URL check (src/utils/remote-fetch.ts): pass=127 fail=1 -> ✖ httpsOnly refuses a redirect that ended on http: (1.471983ms)
[UNIT] remote-fetch: requireImageContentType check (src/utils/remote-fetch.ts): pass=127 fail=1 -> ✖ requireImageContentType refuses an HTML login page (1.53743ms)
[UNIT] remote-fetch: abort timeout (src/utils/remote-fetch.ts): pass=127 fail=1 -> ✖ aborts when the server is slower than the timeout (201.863869ms)
[UNIT] downloadRemoteImages: opt-in setting gate (src/host/downloadRemoteImages.ts): pass=127 fail=1 -> ✖ with the setting off makes no request at all (5.958001ms)
[UNIT] downloadRemoteImages: https-only URL filter (src/host/downloadRemoteImages.ts): pass=126 fail=2 -> ✖ never fetches a non-https URL, even if the webview sent one (2.498306ms)
[UNIT] downloadRemoteImages: per-image failure isolation (src/host/downloadRemoteImages.ts): pass=126 fail=2 -> ✖ a failed image keeps its URL and does not stop the others (0.905294ms)
[UNIT] downloadRemoteImages: use writeImage returned relativePath (src/host/downloadRemoteImages.ts): pass=127 fail=1 -> ✖ downloads, saves through writeImage and reports url -> writeImage's returned relativePath (2.833795ms)
[UNIT] downloadRemoteImages: per-paste URL cap (src/host/downloadRemoteImages.ts): pass=127 fail=1 -> ✖ caps how many one paste may fetch (2.821663ms)
[UNIT] downloadRemoteImages: reject unknown image subtype (src/host/downloadRemoteImages.ts): pass=126 fail=2 -> ✖ an image type it cannot name is kept remote rather than saved as .bin (2.830699ms)
[UNIT] pickImage: reply on cancelled dialog (src/host/pickImage.ts): pass=127 fail=1 -> ✖ a cancelled dialog reads nothing, writes nothing and still answers (2.484522ms)
[UNIT] pickImage: file size cap before readFile (src/host/pickImage.ts): pass=127 fail=1 -> ✖ refuses a file over the size cap without reading it (1.944921ms)
[UNIT] pickImage: pass read bytes to writeImage (src/host/pickImage.ts): pass=127 fail=1 -> ✖ saves the picked file's bytes and replies with writeImage's returned relativePath (6.872067ms)
[UNIT] pickImage: use writeImage returned relativePath (src/host/pickImage.ts): pass=127 fail=1 -> ✖ saves the picked file's bytes and replies with writeImage's returned relativePath (9.065292ms)
[UNIT] pickImage: sanitize invalid filename characters (src/host/pickImage.ts): pass=127 fail=1 -> ✖ replaces characters writeImage would reject instead of failing (1.620219ms)
[UNIT] pickImage: prefix Windows reserved device names (src/host/pickImage.ts): pass=127 fail=1 -> ✖ prefixes Windows reserved device names so writeImage does not reject them (1.743347ms)
[UNIT] pickImage: reject non-image extension (src/host/pickImage.ts): pass=126 fail=2 -> ✖ refuses a file that is not a known image type (1.809676ms)
RESTORED UNIT: ['ℹ tests 128', 'ℹ pass 128', 'ℹ fail 0']
```

### 3.2. Răng của seam `harness/image-insert-seam.ts` (`seams/image-insert.txt`)

8 đột biến trên `src/webview/image-insert.ts` và `src/webview/image-path-translation.ts`, mỗi đột biến chạy `npm run roundtrip` rồi khôi phục bằng `git checkout -- <file>`:

Lệnh:
```sh
python3 - <<'EOF'
import subprocess, re
ROOT = "/home/tuanhv/.paseo/worktrees/3t05p45h/w11-image-insert"
def sh(cmd):
    return subprocess.run(cmd, shell=True, cwd=ROOT, capture_output=True, text=True, timeout=60).stdout
seam_mutations = [
    ("image-insert: insertImageAt uses recorded pos", "src/webview/image-insert.ts",
     "    .insertContentAt(clamped, {", "    .insertContentAt(1, {"),
    ("image-insert: anchor maps through tr.mapping", "src/webview/image-insert.ts",
     "              next.set(id, tr.mapping.map(pos));", "              next.set(id, pos);"),
    ("image-insert: takeInsertAnchor removes consumed anchor", "src/webview/image-insert.ts",
     "            for (const [id, pos] of anchors) {\n              if (meta?.remove === id) continue;", "            for (const [id, pos] of anchors) {"),
    ("image-insert: replaceRemoteImageSrc exact URL match", "src/webview/image-insert.ts",
     'node.attrs.src === url) {', 'node.attrs.src.startsWith(url)) {'),
    ("image-insert: replaceRemoteImageSrc dispatches transaction", "src/webview/image-insert.ts",
     "  if (count > 0) editor.view.dispatch(tr);", ""),
    ("image-insert: collectRemoteImageUrls https-only filter", "src/webview/image-insert.ts",
     'if (src && /^https:\\/\\//i.test(src) && !out.includes(src)) out.push(src);', 'if (src && !out.includes(src)) out.push(src);'),
    ("image-path-translation: wrapMarkdownDestination on save", "src/webview/image-path-translation.ts",
     "? `![${alt}](${wrapMarkdownDestination(replacement)}${rest})`", "? `![${alt}](${replacement}${rest})`"),
    ("image-path-translation: angle-bracket destination lookup", "src/webview/image-path-translation.ts",
     "(?:<([^<>\\n]*)>|([^)\\s<][^)\\s]*))", "([^)\\s]+)()"),
]
for label, path, old, new in seam_mutations:
    p = ROOT + "/" + path
    s = open(p).read()
    open(p, "w").write(s.replace(old, new))
    try:
        out = sh("npm run roundtrip 2>&1")
        fails = re.findall(r"^FAIL\s+(\S+) \((.*?)\)", out, re.M)
        summary = re.findall(r"45 markdown fixtures \+ 21 seams:.*", out)
        diff_lines = [l for l in out.splitlines() if l.startswith("  -") or l.startswith("  +")]
        print(f"[SEAM] {label} ({path}): {fails} | {summary[-1]}")
        for dl in diff_lines[:6]:
            print("  ", dl)
    finally:
        sh(f"git checkout -- {path}")
out = sh("npm run roundtrip 2>&1")
print("RESTORED SEAM:", re.findall(r"45 markdown fixtures \+ 21 seams:.*", out)[-1])
EOF
```

Output:
```text
[SEAM] image-insert: insertImageAt uses recorded pos (src/webview/image-insert.ts): [('seams/image-insert.txt', '+2 -2 lines')] | 45 markdown fixtures + 21 seams: 65 passed, 1 failed, 0 missing, 0 errored
     --- golden/seams/image-insert.txt
     +++ current/seams/image-insert.txt
     -saved: "Before![photo](images/photo.png)"
     +saved: "![photo](images/photo.png)Before"
     -saved: "XXhe![pic](images/pic.png)llo"
     +saved: "![pic](images/pic.png)XXhello"
[SEAM] image-insert: anchor maps through tr.mapping (src/webview/image-insert.ts): [('seams/image-insert.txt', '+1 -1 lines')] | 45 markdown fixtures + 21 seams: 65 passed, 1 failed, 0 missing, 0 errored
     --- golden/seams/image-insert.txt
     +++ current/seams/image-insert.txt
     -saved: "XXhe![pic](images/pic.png)llo"
     +saved: "XX![pic](images/pic.png)hello"
[SEAM] image-insert: takeInsertAnchor removes consumed anchor (src/webview/image-insert.ts): [('seams/image-insert.txt', '+1 -1 lines')] | 45 markdown fixtures + 21 seams: 65 passed, 1 failed, 0 missing, 0 errored
     --- golden/seams/image-insert.txt
     +++ current/seams/image-insert.txt
     -anchor taken again: false
     +anchor taken again: true
[SEAM] image-insert: replaceRemoteImageSrc exact URL match (src/webview/image-insert.ts): [('seams/image-insert.txt', '+2 -2 lines')] | 45 markdown fixtures + 21 seams: 65 passed, 1 failed, 0 missing, 0 errored
     --- golden/seams/image-insert.txt
     +++ current/seams/image-insert.txt
     -replaced: 1
     -after: "![x](https://cdn.example.com/a.png?v=2)\n\n![y](images/image-3.png)"
     +replaced: 2
     +after: "![x](images/image-3.png)\n\n![y](images/image-3.png)"
[SEAM] image-insert: replaceRemoteImageSrc dispatches transaction (src/webview/image-insert.ts): [('seams/image-insert.txt', '+3 -3 lines')] | 45 markdown fixtures + 21 seams: 65 passed, 1 failed, 0 missing, 0 errored
     --- golden/seams/image-insert.txt
     +++ current/seams/image-insert.txt
     -after: "![a](images/image-1.png)\n\n![b](https://cdn.example.com/b.png)"
     +after: "![a](https://cdn.example.com/a.png)\n\n![b](https://cdn.example.com/b.png)"
     -after: "![one](images/image-2.png)\n\n![two](images/image-2.png)"
     +after: "![one](https://cdn.example.com/a.png)\n\n![two](https://cdn.example.com/a.png)"
[SEAM] image-insert: collectRemoteImageUrls https-only filter (src/webview/image-insert.ts): [('seams/image-insert.txt', '+1 -1 lines')] | 45 markdown fixtures + 21 seams: 65 passed, 1 failed, 0 missing, 0 errored
     --- golden/seams/image-insert.txt
     +++ current/seams/image-insert.txt
     -urls: ["https://a.example/1.png","https://b.example/4.jpg"]
     +urls: ["https://a.example/1.png","http://a.example/2.png","data:image/png;base64,AAAA","relative/3.png","https://b.example/4.jpg"]
[SEAM] image-path-translation: wrapMarkdownDestination on save (src/webview/image-path-translation.ts): [('seams/image-insert.txt', '+2 -2 lines')] | 45 markdown fixtures + 21 seams: 65 passed, 1 failed, 0 missing, 0 errored
     --- golden/seams/image-insert.txt
     +++ current/seams/image-insert.txt
     -saved: "![my photo](<images/my photo.png>)"
     +saved: "![my photo](images/my photo.png)"
     -saved: "![my photo](<images/my photo.png>)"
     +saved: "![my photo](images/my photo.png)"
[SEAM] image-path-translation: angle-bracket destination lookup (src/webview/image-path-translation.ts): [('seams/image-insert.txt', '+1 -1 lines')] | 45 markdown fixtures + 21 seams: 65 passed, 1 failed, 0 missing, 0 errored
     --- golden/seams/image-insert.txt
     +++ current/seams/image-insert.txt
     -display: "![my photo](https://file+.vscode-resource.vscode-cdn.net/ws/images/my%20photo.png)\n"
     +display: "![my photo](<images/my photo.png>)\n"
RESTORED SEAM: 45 markdown fixtures + 21 seams: 66 passed, 0 failed, 0 missing, 0 errored
```

---

## 4. Tiêu chí chưa kiểm được trực tiếp

- **Hoạt động thực tế trên phiên Remote SSH / WSL (#173):** Chưa kiểm thật trên kết nối Remote SSH hoặc WSL vì môi trường chạy worker là máy Linux cục bộ headless. Tính đúng đắn trên remote được đảm bảo theo cấu trúc: `vscode.window.showOpenDialog` là dialog của workspace/UI và `vscode.workspace.fs.stat` / `vscode.workspace.fs.readFile` / `vscode.workspace.fs.writeFile` (bên trong `writeImage`) làm việc trên `vscode.Uri` của workspace filesystem provider thay vì gọi công cụ clipboard hệ điều hành trên extension host.
- **Lái hộp thoại native `showOpenDialog` bằng CDP trong floor check (#173):** Hộp chọn file của hệ điều hành / Electron không nằm trong DOM của webview nên CDP không bấm chọn file được. Cách kiểm trong floor check được đặc tả ở Mục 6 bên dưới (stub `vscode.window.showOpenDialog` trong `extension-tests.ts`).

---

## 5. Kết quả kiểm tra trước khi kết thúc (`DONE:`)

### 5.1. `npm run lint` và `npm run build`

Lệnh:
```sh
npm run lint && npm run build
```

Output:
```text
> tui-milkdown-vscode@3.4.2 lint
> tsc --noEmit

> tui-milkdown-vscode@3.4.2 build
> node esbuild.config.js

Building (production)...
Build complete (production)
webview bundle: 1031180 B / 1100000 B budget
```

### 5.2. `npm test`

Lệnh:
```sh
npm test
```

Output (tóm tắt):
```text
ℹ tests 128
ℹ suites 33
ℹ pass 128
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 336.875824
```

### 5.3. `npm run roundtrip` (Vòng 1)

Lệnh:
```sh
npm run roundtrip
```

Output (tóm tắt):
```text
harness built: out/harness/roundtrip.js
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package
markdown roundtrip harness — mode: check
corpus: 45 fixtures (40 synthetic, 5 repo docs)

──────────────────────────────────────────
──────────────────────────────────────────
45 markdown fixtures + 21 seams: 66 passed, 0 failed, 0 missing, 0 errored
```

### 5.4. Vòng hai và bước khôi phục

Lệnh:
```sh
cp harness/golden/synthetic/*.md harness/fixtures/synthetic/ && npm run roundtrip
git checkout -- harness/fixtures/synthetic/
git status --short harness/
```

Output (tóm tắt):
```text
harness built: out/harness/roundtrip.js
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package
markdown roundtrip harness — mode: check
corpus: 45 fixtures (40 synthetic, 5 repo docs)

──────────────────────────────────────────
──────────────────────────────────────────
45 markdown fixtures + 21 seams: 66 passed, 0 failed, 0 missing, 0 errored
```
`git status --short harness/` sau khôi phục: rỗng.

### 5.5. Kiểm tra không sửa fixture cũ

Lệnh:
```sh
MB=$(git merge-base develop HEAD)
git diff $MB..HEAD --stat -- harness/fixtures/synthetic/
```

Output:
```text
(rỗng)
```

### 5.6. VS Code floor check (`npm run verify:vscode-floor`)

Lệnh:
```sh
PUPPETEER_EXECUTABLE_PATH=$HOME/.cache/puppeteer-floor/chrome-nosandbox \
  xvfb-run -a -s "-screen 0 1920x1080x24" npm run verify:vscode-floor
```

Output (các check liên quan và dòng tổng kết):
```text
PASS  export produces a real DOCX file — floor-export.docx bytes=32169 magic=504b0304 (expected 504b0304)
PASS  export produces a real PDF file — floor-export.pdf bytes=74257 magic=25504446 (expected 25504446)
PASS  slash command opens a filtered block menu — open=true items=19 attachedToEditorContainer=true caretIn=p:"/"
PASS  no CSP violation in the console — 3 console entries, none CSP

63 checks: 63 passed, 0 failed
```

---

## 6. Đặc tả floor check đề xuất (#173 và #174)

### 6.1. Floor check cho #173: `insert image from file picker writes the file and inserts the relative link at the caret`

- **Vì sao cần phối hợp `extension-tests.ts` + `run.mjs`:** `vscode.window.showOpenDialog` mở hộp thoại native ngoài tầm của CDP. Trong `harness/vscode-floor/extension-tests.ts` (chạy bên trong extension host thật), ta có thể tạo sẵn một file ảnh PNG thật (ví dụ 1x1 PNG tại `path.join(workspaceDir, "picker-source", "Picked Photo.png")`) và bọc tạm thời `vscode.window.showOpenDialog` trong pha interactive để trả về `[vscode.Uri.file(pickedSourcePath)]` đồng thời ghi nhận số lần `showOpenDialog` được gọi và `filters` nhận được.
- **Thao tác (trong `run.mjs`):**
  1. Đặt con trỏ vào cuối một đoạn văn xác định trong editor (hoặc gõ `/file` trong đoạn trống rồi nhấn `Enter` để chọn mục `Image from file…`, hoặc click `.toolbar-btn[data-command="imageFromFile"]`).
  2. Chờ node `img` mới xuất hiện trong `.tiptap` có `alt="Picked Photo"` và `src` là webview resource URI trỏ tới thư mục ảnh của tài liệu.
- **Đọc & Khẳng định (trong `run.mjs` và `extension-tests.ts`):**
  1. Trên webview DOM (`run.mjs`): số lượng `.tiptap img[alt="Picked Photo"]` tăng thêm 1, `img.getAttribute("src")` bắt đầu bằng `https://file+.vscode-resource.vscode-cdn.net/` (không phải `data:`).
  2. Trên extension host (`extension-tests.ts` sau `phase-driven`):
     - `showOpenDialog` đã được gọi đúng 1 lần với `filters.Images` chứa `"png"`.
     - File ảnh đích tồn tại trên đĩa trong thư mục `images/` của workspace (`fs.existsSync`).
     - Nội dung `document.getText()` chứa `![Picked Photo](<images/Picked Photo.png>)` (bọc `<...>` vì tên file có dấu cách).
- **Phá cái gì thì phải đỏ:**
  - Bỏ handler `pickImage` trong `src/host/messageHandlers.ts` hoặc không gửi `imagePicked` → không có node `img[alt="Picked Photo"]` và `document.getText()` không có link ảnh.
  - Bỏ `wrapMarkdownDestination` trong `src/webview/image-path-translation.ts` → `document.getText()` chứa `![Picked Photo](images/Picked Photo.png)` không bọc `<...>`, check khẳng định chuỗi markdown đỏ.

### 6.2. Floor check cho #174: `pasting HTML with https images respects downloadRemoteImagesOnPaste`

- **Thiết lập:**
  - Trong `src/host/downloadRemoteImages.ts`, `fetchRemoteBytes` đi qua `globalThis.fetch` của extension host. Trong `extension-tests.ts` (hoặc qua việc stub `globalThis.fetch` trong extension host khi chạy floor tests cho URL sentinel `https://floor-remote.test/ok.png` và `https://floor-remote.test/fail.png`), `ok.png` trả về `Response` 200 với byte PNG 1x1 và header `content-type: image/png`, còn `fail.png` trả về `Response` 403.
- **Thao tác & Khẳng định (2 pha):**
  1. **Khi setting mặc định (`false`):** Trong `run.mjs`, tổng hợp và dispatch một `ClipboardEvent("paste")` lên `.tiptap` với `clipboardData` chứa `text/html`: `<p><img src="https://floor-remote.test/ok.png" alt="r1"></p>`. Khẳng định trên host: bộ đếm số lần `fetch` bị gọi bằng `0`, và `document.getText()` giữ nguyên `![r1](https://floor-remote.test/ok.png)`.
  2. **Khi bật `tuiMarkdown.downloadRemoteImagesOnPaste = true` (qua `vscode.workspace.getConfiguration("tuiMarkdown").update` trong `extension-tests.ts`):** Dispatch sự kiện paste HTML chứa `<p><img src="https://floor-remote.test/ok.png" alt="r2"><img src="https://floor-remote.test/fail.png" alt="r3"></p>`. Chờ debounce edit hoàn tất. Khẳng định:
     - `ok.png` đã được ghi vào `images/` trên đĩa và trong `document.getText()` chuỗi `![r2](images/...)` thay thế cho `https://floor-remote.test/ok.png`.
     - `fail.png` vẫn giữ nguyên `![r3](https://floor-remote.test/fail.png)` trong `document.getText()`.
- **Phá cái gì thì phải đỏ:**
  - Bỏ kiểm tra `if (!deps.isEnabled(document)) return;` trong `src/host/downloadRemoteImages.ts` → pha 1 gọi `fetch` khi setting đang tắt → đỏ.
  - Bỏ `replaceRemoteImageSrc` hoặc bọc nhầm trong `guardExtensionUpdate` ở `src/webview/main.ts` → `document.getText()` trên host không nhận được đường dẫn cục bộ `images/...` → đỏ.

---

## 7. Câu chữ đề xuất cho tài liệu gốc

### 7.1. `CHANGELOG.md` (dưới `## [Unreleased]`)

```markdown
### Added
- **Insert image from file picker (#173)**: Added an "Image from file…" slash command (`/file`, `/image`) and toolbar button that open VS Code's file picker (`showOpenDialog`), read the selected image on the extension host via `workspace.fs.readFile`, and save it into the configured image folder without round-tripping base64 data through the webview (works across Remote SSH and WSL workspaces). Cursor position is tracked through ProseMirror document mapping while the dialog is open.
- **Opt-in remote image download on HTML paste (#174)**: Added `tuiMarkdown.downloadRemoteImagesOnPaste` (default `false`). When enabled, pasting HTML containing `https://` `<img src>` tags downloads the images on the extension host (with size and timeout limits), saves them through `writeImage`, and rewrites the pasted image nodes to their local relative paths while preserving remote URLs for any images that fail to download.

### Fixed
- **Image path translation for paths with spaces (#173)**: Updated `transformForDisplay` and `transformForSave` in `src/webview/image-path-translation.ts` to match `<...>`-wrapped Markdown image destinations and re-wrap saved paths containing whitespace with `wrapMarkdownDestination`.
```

### 7.2. `README.md`

Thêm vào danh sách tính năng ảnh / Settings:
```markdown
- **Insert Image from File**: Pick an image via the `/image-file` slash command or toolbar button — reads and copies the file on the host so it works in Remote SSH and WSL workspaces.
- `tuiMarkdown.downloadRemoteImagesOnPaste` (default: `false`): When pasting HTML that contains `https://` images, download them into `imageSaveFolder` and rewrite the links to local relative paths.
```

### 7.3. `AGENTS.md`

- Dưới `src/host/` trong mục **File Structure**:
```markdown
│   ├── pickImage.ts          # pickImage (#173): showOpenDialog + workspace.fs.readFile + writeImage; no base64 through the webview
│   ├── downloadRemoteImages.ts # downloadRemoteImages (#174): opt-in https image fetch on HTML paste via remote-fetch.ts + writeImage
```
- Dưới `src/utils/` trong mục **File Structure**:
```markdown
│   ├── remote-fetch.ts       # Shared size- and time-limited fetchRemoteBytes used by export-docx.ts and downloadRemoteImages.ts (#174)
```
- Dưới `src/webview/` trong mục **File Structure**:
```markdown
│   ├── image-insert.ts       # ImageInsertAnchors plugin (maps cursor position while file dialog is open), insertImageAt, replaceRemoteImageSrc, collectRemoteImageUrls (#173, #174)
```
- Dưới `harness/` trong mục **File Structure**:
```markdown
├── image-insert-seam.ts            # Markdown written for a file-picker image (including <...> on spaces and mapped anchor) and remote-to-local src replacement (#173, #174)
```
- Dưới mục **Configuration Settings**:
```markdown
- `downloadRemoteImagesOnPaste` (boolean, default: false) - Download `https:` images in pasted HTML into `imageSaveFolder` and rewrite their links (#174)
```
