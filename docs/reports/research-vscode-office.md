# Nghiên cứu: học được gì từ cweijan/vscode-office

Ngày: 2026-10-18. Phạm vi: phần Markdown editor của `cweijan/vscode-office` (Office Viewer), so với Tiptap Markdown Editor 3.4.2 (repo này).

## Tóm tắt

vscode-office là một extension "đa năng" (Excel, PDF, DOCX, Git History, REST client...), trong đó Markdown chỉ là một phần, chạy trên một bản fork của Vditor. Về độ đúng của roundtrip, cơ chế chống vòng lặp edit và kỷ luật kiểm thử thì repo này đã đi trước. Có ba nhóm đáng học:

1. **Vá nhanh, giá trị cao**: flush edit đang chờ khi nhấn `Ctrl/Cmd+S` (họ có, mình chưa có, cần kiểm chứng bằng repro), bookmark cho PDF (`outline: true` của puppeteer), và giới hạn `customEditors` theo scheme bằng allowlist thay cho denylist.
2. **Tính năng điều hướng và ảnh**: điều hướng tới `#heading` khi mở sang file khác (`[[page#heading]]`, `file.md#heading`), mẫu đường dẫn ảnh có biến (`${fileName}`, `${date}`...), chèn ảnh qua hộp thoại chọn file (dùng được cả khi Remote SSH/WSL).
3. **Bài học từ issue của họ**: con trỏ nhảy lên đầu file khi auto-save, thư viện vendored bị cũ (mermaid), TOC bị chèn ép vào thân PDF, chiếm phím `Ctrl+V` của text editor, `localResourceRoots` mở cả `/`. Mình đã tránh được phần lớn những lỗi này, và nên giữ nguyên như vậy.

## Snapshot của vscode-office

| Mục | Giá trị |
| --- | --- |
| Phiên bản | 4.2.2 (changelog ghi ngày 2026-10-15) |
| Commit đã clone | `2755c6fb1c17bd35c11295af38a648f4f9917be7` (shallow clone, chỉ đọc, không build/không cài) |
| License | MIT, Copyright (c) 2020 Weijan Chen ([LICENSE](https://github.com/cweijan/vscode-office/blob/2755c6fb1c17bd35c11295af38a648f4f9917be7/LICENSE)) |
| `engines.vscode` | `^1.64.0` (của mình là `^1.85.0`) |
| Editor Markdown | Bản fork Vditor `vscode-vditor` 4.0.0 (thư mục `vditor/`, homepage `vscode-ext-studio/vditor`, `vditor/package.json` không khai báo trường `license`; Vditor gốc là MIT). Parser là Lute (`vditor/src/js/lute/lute.min.js`, bundle WASM/JS đã minify) |
| Code block | CodeMirror 6 nhúng trong block (`vditor/src/ts/codeBlock/*`) |
| Export | markdown-it + puppeteer-core (PDF), `vscode-html-to-docx` (DOCX), HTML; bookmark PDF qua `pdf-lib` |
| Chế độ | `wysiwyg` và `ir` (instant render kiểu Typora) |
| Khác | Có bản web (`browser: ./out/extension.web.js`), telemetry bật mặc định, một số tính năng "Pro" trả phí (changelog 4.2.1: TTS, cấu hình phím tắt) |

**Về license**: MIT nên về pháp lý có thể chép code, miễn là giữ copyright notice và nội dung giấy phép MIT trong file được chép (hoặc trong NOTICE). Có ba lưu ý. (1) Thư mục `vditor/` không ghi license riêng trong `package.json`, nên coi như MIT theo LICENSE ở gốc repo cộng với MIT của Vditor upstream. Nếu chép từ đây thì ghi cả hai nguồn. (2) `lute.min.js` là artifact đã minify, không nên chép. (3) Không thấy code của các tính năng "Pro" (TTS, phím tắt tuỳ biến) trong repo, nên những mục đó chỉ học ở mức ý tưởng. Hầu hết đề xuất bên dưới là ý tưởng hoặc một vài dòng gọi API, nên tự viết lại theo convention của repo này sẽ tốt hơn chép.

## Danh sách đề xuất theo ưu tiên

Thang ưu tiên: **P0** nên làm ngay (rẻ, giá trị cao hoặc có thể là bug), **P1** nên làm trong chu kỳ tới, **P2** có giá trị nhưng không gấp, **P3** chỉ cân nhắc khi có nhu cầu rõ ràng. Effort: XS (dưới 1 giờ), S (nửa ngày), M (1 đến 3 ngày), L (trên 1 tuần).

| # | Ưu tiên | Đề xuất | Loại | Effort | Module của mình bị ảnh hưởng |
| --- | --- | --- | --- | --- | --- |
| 1 | P0 | Flush edit đang debounce trước khi lưu (`Ctrl/Cmd+S`) | Kỹ thuật / có thể là bug | S | `src/webview/main.ts`, `src/webview/content-sync.ts` |
| 2 | P0 | Bookmark (outline) cho PDF bằng `page.pdf({ outline: true })` | Tính năng | XS | `src/utils/export-pdf.ts` |
| 3 | P1 | Selector `customEditors` dùng allowlist scheme (`file:`, `vscode-remote:`, `vscode-vfs:`) | Kỹ thuật | S | `package.json`, floor check |
| 4 | P1 | Mở file khác rồi cuộn tới `#heading` (wiki link và link thường) | Tính năng | M | `src/host/openWikiLink.ts`, `src/host/openLocalFile.ts`, `src/shared/messages.ts`, `src/webview/wiki-link-plugin.ts`, `scrollToHeading` |
| 5 | P1 | Mẫu đường dẫn ảnh có biến (`${fileName}`, `${date}`, `${now}`, `${uuid}`, `${workspaceDir}`) | Tính năng | M | `src/host/config.ts`, `src/host/saveImage.ts`, `src/webview/main.ts` |
| 6 | P1 | Chèn ảnh qua hộp thoại chọn file (copy vào thư mục ảnh) | Tính năng | S | `src/webview/slash-command-plugin.ts`, handler mới trong `src/host/messageHandlers.ts` |
| 7 | P2 | Tải ảnh remote về local khi paste (họ CHƯA có, user đòi nhiều) | Tính năng (khoảng trống chung) | M | `src/webview/main.ts` (paste), `src/host/saveImage.ts` |
| 8 | P2 | Export HTML tự chứa | Tính năng | M | `src/host/exportDocument.ts`, tái dùng pipeline của `src/utils/export-pdf.ts` |
| 9 | P2 | Mở source "beside" (song song với WYSIWYG) | Tính năng | S | `src/extension.ts`, `package.json` |
| 10 | P2 | Nhận diện định dạng ảnh thật bằng magic bytes khi lưu | Kỹ thuật | S | `src/host/saveImage.ts` |
| 11 | P2 | Phím tắt di chuyển block lên/xuống, chèn đoạn trống trước/sau | Tính năng | S | ProseMirror keymap mới, đăng ký cạnh `list-keymap-extension.ts` |
| 12 | P2 | Truyền `markdown.math.macros` của VS Code sang KaTeX | Tính năng | XS | `src/host/config.ts`, `src/webview/math-extension.ts` |
| 13 | P2 | Thêm fixture roundtrip cho khoảng trắng trước inline trong ô bảng (repro của họ ở #619) | Phòng ngừa | XS | `harness/fixtures/synthetic/` |
| 14 | P3 | `dir="auto"` cho RTL | Tính năng | S | `src/webview/editor.css`, `extension-factory.ts` |
| 15 | P3 | Bản địa hoá UI (`package.nls.*.json` + chuỗi webview) | Tính năng | M | `package.json`, webview |
| 16 | P3 | AI chỉnh văn qua `vscode.lm` kèm diff review | Tính năng | L | mới; vướng floor 1.85 |
| 17 | P3 | Chạy được trên web (vscode.dev / github.dev) | Kiến trúc | L | toàn bộ host |
| 18 | P3 | Chế độ IR (hiện marker markdown khi con trỏ nằm trong) | Tính năng | L | không khớp kiến trúc, xem chi tiết |

Base URL cho các trích dẫn bên dưới: `https://github.com/cweijan/vscode-office/blob/2755c6fb1c17bd35c11295af38a648f4f9917be7/`, viết tắt là `[VO]`. Số reaction (r) và số comment (c) lấy từ GitHub GraphQL ngày 2026-10-18.

### 1. P0: Flush edit đang chờ trước khi lưu

- **Là gì**: Họ chặn `Ctrl/Cmd+S` trong webview, gửi `doSave` kèm nội dung hiện tại. Host xả hàng đợi ghi rồi mới gọi `workbench.action.files.save`.
- **Bằng chứng**: [VO `resource/markdown/util.js#L261-L276`](https://github.com/cweijan/vscode-office/blob/2755c6fb1c17bd35c11295af38a648f4f9917be7/resource/markdown/util.js#L261-L276) và [VO `src/provider/markdownEditorProvider.ts#L304-L309`](https://github.com/cweijan/vscode-office/blob/2755c6fb1c17bd35c11295af38a648f4f9917be7/src/provider/markdownEditorProvider.ts#L304-L309) (`doSave`: flush rồi save).
- **Phía mình**: webview debounce 300 ms (`ContentSync.debouncedPostEdit`) và chỉ flush khi `visibilitychange`/`pagehide` (`src/webview/main.ts:1913-1925`). Không tìm thấy chỗ nào bắt `Mod-s`, không có `onWillSaveTextDocument` ở host, cũng không có message nào từ host yêu cầu flush (`src/shared/messages.ts`). **Giả thuyết cần kiểm chứng**: gõ rồi nhấn `Cmd+S` trong vòng 300 ms thì VS Code lưu TextDocument chưa có các ký tự cuối. Sau đó `edit` mới tới làm document dirty trở lại, và file trên đĩa thiếu đúng phần vừa gõ. Repro: gõ "abc" rồi nhấn `Cmd+S` ngay, đọc file trên đĩa và xem tab có còn dấu dirty không.
- **Cách làm**: trong webview, bắt `keydown` `Mod+S` (capture phase), gọi `flushPendingEdit()` rồi để VS Code xử lý keybinding như bình thường. Cách này không cần `preventDefault`, vì `edit` được post trước và host áp dụng bằng `applyEdit` trước khi lệnh save tới. Nếu thứ tự không được đảm bảo thì làm như họ: thêm message `saveRequest` để host `await session.applyEdit` xong mới `workbench.action.files.save`. Lối ra duy nhất của `edit` vẫn là `ContentSync.postEdit()` (#148), nên không phát sinh writer thứ hai.
- **Rủi ro**: thứ tự IPC giữa message của webview và keybinding của workbench chưa được đo. Cần một floor check (gõ, nhấn `Cmd+S` qua `Input.dispatchKeyEvent`, đọc file và `isDirty`), và phải bẻ code để xác nhận check đó có thể đỏ.

### 2. P0: Bookmark cho PDF

- **Là gì**: PDF xuất ra có cây outline (bookmark) theo heading.
- **Bằng chứng**: Họ tự dựng outline bằng `pdf-lib` từ HTML của TOC ([VO `src/service/markdown/outline.js#L1-L18`](https://github.com/cweijan/vscode-office/blob/2755c6fb1c17bd35c11295af38a648f4f9917be7/src/service/markdown/outline.js#L1-L18), được gọi ở [VO `src/service/markdown/html-export.js#L89`](https://github.com/cweijan/vscode-office/blob/2755c6fb1c17bd35c11295af38a648f4f9917be7/src/service/markdown/html-export.js#L89)). Cái giá họ trả là phải chèn `[toc]` vào thân văn bản ([VO `markdown-pdf.js#L53-L63`](https://github.com/cweijan/vscode-office/blob/2755c6fb1c17bd35c11295af38a648f4f9917be7/src/service/markdown/markdown-pdf.js#L53-L63)), và user phàn nàn: [#84](https://github.com/cweijan/vscode-office/issues/84) (c4), [#105](https://github.com/cweijan/vscode-office/issues/105) (c4).
- **Phía mình**: `puppeteer-core` 24.43.1 đã có option `outline?: boolean` (`node_modules/puppeteer-core/lib/types.d.ts:7926-7931`). `src/utils/export-pdf.ts:110-116` chưa truyền option này. Chỉ cần thêm `outline: true` (cân nhắc thêm `tagged: true` cho accessibility). Không cần `pdf-lib` và không phải chèn TOC vào thân.
- **Rủi ro**: Option này thuộc Chromium, và Chrome/Edge cũ có thể bỏ qua nó. Vì user tự chọn trình duyệt qua `chromium-discovery.ts`, cần kiểm tra trên bản Chrome đang có. Bundle không đổi vì export được lazy-load.

### 3. P1: Allowlist scheme cho `customEditors`

- **Là gì**: Selector của họ chỉ khớp `file:/**/*.md`, `vscode-vfs:/**/*.md`, `vscode-remote:/**/*.md` (và `.markdown`). Vì vậy diff của git, GitLens, PR hay agent (Cline...) tự rơi về text editor mà không cần liệt kê từng scheme.
- **Bằng chứng**: [VO `package.json#L532-L553`](https://github.com/cweijan/vscode-office/blob/2755c6fb1c17bd35c11295af38a648f4f9917be7/package.json#L532-L553). Changelog 3.2.0 ghi "Use vscode default editor when diffing". Các issue: [#183](https://github.com/cweijan/vscode-office/issues/183) (r6, c5), [#200](https://github.com/cweijan/vscode-office/issues/200) (r6), [#153](https://github.com/cweijan/vscode-office/issues/153) (r1, c3), [#390](https://github.com/cweijan/vscode-office/issues/390) (comment về diff của Cline).
- **Phía mình**: selector `*.md`/`*.markdown` khớp mọi scheme, kèm denylist `{git,gitlens,git-graph}:` trong `configurationDefaults` (`package.json`, CHANGELOG mục #48). Mỗi scheme mới (ví dụ `pr:`, `review:`, diff của agent) lại thành một issue #48 mới.
- **Cách làm**: đổi selector sang allowlist và giữ `configurationDefaults` làm lớp phòng thủ thứ hai (hoặc bỏ nếu thấy thừa). VS Code khớp pattern có `/` theo dạng `scheme:path`, cơ chế đã có từ trước 1.64, nên floor 1.85 dùng được.
- **Rủi ro**: file `untitled:` sẽ không còn mở WYSIWYG. Đây có thể là điểm cộng, nhưng cần ghi vào CHANGELOG. Phải kiểm tra Remote SSH/WSL, nơi document dùng scheme `file` ở phía remote, và check `vscode.diff` hiện có trong `harness/vscode-floor/extension-tests.ts` phải vẫn xanh. `tuiMarkdown.useAsDefaultEditor` ghi `*.md` vào workspace, có thể đè allowlist, nên cần xem lại `src/host/defaultEditor.ts`.

### 4. P1: Điều hướng tới heading khi mở file khác

- **Là gì**: `[[Note#Heading]]`, `[[Note#^block-id]]` và `[x](other.md#heading)` mở file đích rồi cuộn tới anchor. Nếu đích chưa có webview, fragment được giữ "pending" theo URI và tiêu thụ khi webview `init`. Nếu đã có webview thì gửi `gotoBlock`.
- **Bằng chứng**: [VO `src/service/markdown/blockScroll.ts#L1-L52`](https://github.com/cweijan/vscode-office/blob/2755c6fb1c17bd35c11295af38a648f4f9917be7/src/service/markdown/blockScroll.ts#L1-L52), [VO `wikilink/open.ts#L12-L38`](https://github.com/cweijan/vscode-office/blob/2755c6fb1c17bd35c11295af38a648f4f9917be7/src/service/markdown/wikilink/open.ts#L12-L38), [VO `wikilink/parse.ts#L8-L21`](https://github.com/cweijan/vscode-office/blob/2755c6fb1c17bd35c11295af38a648f4f9917be7/src/service/markdown/wikilink/parse.ts#L8-L21), [VO `wikilink/fragment.ts#L11-L36`](https://github.com/cweijan/vscode-office/blob/2755c6fb1c17bd35c11295af38a648f4f9917be7/src/service/markdown/wikilink/fragment.ts#L11-L36), và phía webview [VO `resource/markdown/index.js#L189-L192`](https://github.com/cweijan/vscode-office/blob/2755c6fb1c17bd35c11295af38a648f4f9917be7/resource/markdown/index.js#L189-L192).
- **Phía mình**: tokenizer `[[...]]` dùng `[^\]|]+?` (`src/webview/wiki-link-plugin.ts:229`), nên `[[Note#Heading]]` tạo `filename = "Note#Heading"`. Khi đó `openWikiLink` glob `**/Note#Heading.md`, không tìm thấy gì, rồi đề nghị **tạo file `Note#Heading.md`** (`src/host/openWikiLink.ts`). Đây là bug thật, không chỉ là thiếu tính năng. Với link thường, `openLocalFileInEditor` tách `#anchor` rồi bỏ đi (`src/host/openLocalFile.ts:19-22`), và không có bước nào cuộn tới đó.
- **Cách làm**: tách fragment trong `openWikiLink` và `openLocalFileInEditor`. Lưu `Map<docKey, fragment>` ở provider. Message `ready` mới hoặc `update` đầu tiên mang theo `pendingFragment`. Thêm `HostToWebviewMessage` `scrollTo` và một handler tương ứng, để `tsc` bắt được trường hợp thiếu. Webview dùng `scrollToHeading` + `headingSlug()` (một định nghĩa duy nhất, `heading-slug.ts`). `^block-id` là phần tuỳ chọn.
- **Rủi ro**: cuộn lúc mở trúng đúng loại bẫy `requestAnimationFrame` khi cửa sổ bị che (#112, #121), nên phải dùng cặp rAF + timer đã latch. #121 (khôi phục vị trí) từng bị rút lại theo yêu cầu user. Tính năng này khác #121 vì chỉ chạy khi có fragment tường minh, nhưng nên hỏi lại user trước khi làm.

### 5. P1: Mẫu đường dẫn ảnh có biến

- **Là gì**: setting `pasterImgPath`, mặc định `image/${fileName}/${now}.${ext}`, với các biến `workspaceDir`, `fileName`, `now`, `date`, `uuid`, `ext`. Kèm theo đó là tuỳ chọn lưu ảnh vào gốc workspace với link bắt đầu bằng `/`.
- **Bằng chứng**: [VO `src/common/fileUtil.ts#L12-L40`](https://github.com/cweijan/vscode-office/blob/2755c6fb1c17bd35c11295af38a648f4f9917be7/src/common/fileUtil.ts#L12-L40), [VO `package.json#L687`](https://github.com/cweijan/vscode-office/blob/2755c6fb1c17bd35c11295af38a648f4f9917be7/package.json#L687). Nhu cầu này lặp lại nhiều lần: [#70](https://github.com/cweijan/vscode-office/issues/70) (c6), [#109](https://github.com/cweijan/vscode-office/issues/109) (c4), [#19](https://github.com/cweijan/vscode-office/issues/19) (c4), [#179](https://github.com/cweijan/vscode-office/issues/179) (c3), [#563](https://github.com/cweijan/vscode-office/issues/563) (c3), [#98](https://github.com/cweijan/vscode-office/issues/98) (r1).
- **Phía mình**: `tuiMarkdown.imageSaveFolder` (chỉ thư mục, tương đối với document) cộng tên cố định `image-<timestamp>-<random>.<ext>` (`src/webview/main.ts:252`).
- **Cách làm**: thêm `tuiMarkdown.imageFileNameTemplate` (hoặc mở rộng `imageSaveFolder` để nhận biến). Expand ở host, không ở webview. Giữ nguyên toàn bộ phần kiểm tra filename/folder của `src/host/saveImage.ts` (traversal, tên thiết bị Windows, folder tuyệt đối).
- **Rủi ro**: tương tác với `ImageLedger`, auto-rename và auto-delete (rename được phát hiện "khi thư mục giữ nguyên"). Nếu template sinh thư mục theo `${fileName}` thì cần unit test cho `image-rename-handler.ts`. `${workspaceDir}` mở đường ghi ra ngoài thư mục document, nên phải vẫn nằm trong workspace.

### 6. P1: Chèn ảnh qua hộp thoại chọn file

- **Là gì**: nút hoặc lệnh "Insert image" mở `showOpenDialog`, đọc bằng `workspace.fs.readFile`, rồi ghi vào thư mục ảnh theo đúng luồng paste.
- **Bằng chứng**: [VO `src/provider/markdownEditorProvider.ts#L281-L294`](https://github.com/cweijan/vscode-office/blob/2755c6fb1c17bd35c11295af38a648f4f9917be7/src/provider/markdownEditorProvider.ts#L281-L294). Tác giả dùng chính cách này để trả lời user Remote SSH, nơi clipboard đọc từ máy remote: [#160](https://github.com/cweijan/vscode-office/issues/160) (r2), [#309](https://github.com/cweijan/vscode-office/issues/309) (c3, WSL, vẫn mở).
- **Phía mình**: mục Image trong slash menu hỏi đường dẫn dạng text (`src/webview/slash-command-plugin.ts:220-230`). Clipboard native đi qua `osascript`/PowerShell/`xclip` ở host (`src/host/readClipboardImage.ts`), nên cũng gặp đúng giới hạn khi chạy remote.
- **Cách làm**: thêm message `pickImage` cùng handler, tái dùng `saveImage` để ghi file (dữ liệu đọc ở host nên không phải chuyển base64 qua webview).
- **Rủi ro**: thấp. Cần thêm một seam hoặc floor check cho markdown được chèn.

### 7. P2: Tải ảnh remote về local khi paste

- **Là gì**: paste nội dung từ web có `<img src="https://...">` thì tải ảnh về thư mục ảnh và viết lại link. Typora đã có tính năng này từ lâu.
- **Bằng chứng**: họ **chưa** làm. [#256](https://github.com/cweijan/vscode-office/issues/256) (r1, c3, vẫn mở, comment năm 2026: "26年了这功能还没有啊").
- **Phía mình**: chưa có. Phần DOCX export đã có code tải ảnh remote với giới hạn kích thước (`src/utils/export-docx.ts:439-443`), có thể tách ra dùng chung.
- **Cách làm**: chỉ làm khi user bật (setting tắt mặc định, hoặc hỏi một lần). Host tải về (giới hạn kích thước, timeout, chỉ `https`), rồi đi qua `saveImage`.
- **Rủi ro**: mạng, quyền riêng tư (tải từ URL do nội dung paste quyết định), và các ảnh có auth/cookie. Không làm âm thầm.

### 8. P2: Export HTML

- **Là gì**: menu chuột phải có PDF, PDF không TOC, DOCX và HTML.
- **Bằng chứng**: [VO `resource/markdown/util.js#L203-L216`](https://github.com/cweijan/vscode-office/blob/2755c6fb1c17bd35c11295af38a648f4f9917be7/resource/markdown/util.js#L203-L216), [VO `src/service/markdownService.ts#L14`](https://github.com/cweijan/vscode-office/blob/2755c6fb1c17bd35c11295af38a648f4f9917be7/src/service/markdownService.ts#L14).
- **Phía mình**: `exportDocument.ts` chỉ phân nhánh `pdf`, còn lại là `docx` (`src/host/exportDocument.ts:32,89`). `export-pdf.ts` đã dựng sẵn một HTML hoàn chỉnh (`buildHtmlDocument`) đã sanitize, với ảnh mermaid đã thay. HTML export gần như chỉ là ghi chuỗi đó ra file, cộng với việc inline ảnh local thành data URI.
- **Rủi ro**: ảnh local và CSS phải inline, nếu không file HTML sẽ hỏng khi bị di chuyển. Phải giữ các bất biến sanitize đã ghi ở header của `export-pdf.ts`.

### 9. P2: Mở source song song

- **Là gì**: `editInVSCode` mở text editor của cùng file ở `ViewColumn.Beside`, có phím tắt riêng (`Ctrl+Alt+E`).
- **Bằng chứng**: [VO `src/provider/markdownEditorProvider.ts#L295-L297`](https://github.com/cweijan/vscode-office/blob/2755c6fb1c17bd35c11295af38a648f4f9917be7/src/provider/markdownEditorProvider.ts#L295-L297), [VO `package.json` keybinding `office.markdown.switch`](https://github.com/cweijan/vscode-office/blob/2755c6fb1c17bd35c11295af38a648f4f9917be7/package.json).
- **Phía mình**: `tuiMarkdown.viewSource` thay tab hiện tại (`src/extension.ts:24-29`).
- **Cách làm**: thêm lệnh `tuiMarkdown.viewSourceBeside` (`vscode.openWith(uri, "default", ViewColumn.Beside)`).
- **Rủi ro**: hai editor cùng sửa một document là đúng tình huống "external update" mà `contentBaseline` và `withPendingEdit` sinh ra để xử lý. Mỗi phím gõ ở source sẽ gửi `update` sang webview, nên cần đo việc giữ selection và hiệu năng với file lớn.

### 10. P2: Nhận diện định dạng ảnh bằng magic bytes

- **Là gì**: sau khi ghi ảnh, họ đọc magic bytes (`file-type`). Nếu phần mở rộng sai thì đổi tên file và sửa link.
- **Bằng chứng**: [VO `src/service/markdownService.ts#L162-L170`](https://github.com/cweijan/vscode-office/blob/2755c6fb1c17bd35c11295af38a648f4f9917be7/src/service/markdownService.ts#L162-L170).
- **Phía mình**: phần mở rộng lấy từ MIME hoặc tên file mà webview gửi lên. Nên tự viết một bảng magic bytes nhỏ (PNG, JPEG, GIF, WebP, SVG) thay vì thêm dependency `file-type` (ESM, nặng).
- **Rủi ro**: thấp. Phù hợp làm unit test thuần trong `test/`.

### 11. P2: Phím tắt thao tác block

- **Là gì**: di chuyển block lên/xuống (`Ctrl+Shift+U/D`), chèn block trống trước/sau (`Ctrl+Shift+B/E`), xoá block (`Ctrl+Shift+X`).
- **Bằng chứng**: [VO `shortcut.md#L118-L119`](https://github.com/cweijan/vscode-office/blob/2755c6fb1c17bd35c11295af38a648f4f9917be7/shortcut.md#L118-L119) (bản tiếng Anh). Phần tiếng Trung ở dòng 23-29.
- **Phía mình**: chỉ có drag handle (`drag-handle-plugin.ts`). Nên dùng phím quen thuộc với user VS Code: `Alt+↑/↓` để di chuyển block, `Mod+Enter` / `Mod+Shift+Enter` để chèn dòng trống sau/trước.
- **Rủi ro**: xung đột với keymap của list (`list-keymap-extension.ts`) và của bảng. Nên đặt một seam cho markdown sau thao tác, theo mẫu `harness/list-keys-seam.ts`.

### 12. P2: `markdown.math.macros`

- **Là gì**: đọc setting `markdown.math.macros` có sẵn của VS Code và truyền vào KaTeX.
- **Bằng chứng**: [VO `src/provider/markdownEditorProvider.ts#L481-L493`](https://github.com/cweijan/vscode-office/blob/2755c6fb1c17bd35c11295af38a648f4f9917be7/src/provider/markdownEditorProvider.ts#L481-L493), dùng ở [VO `resource/markdown/index.js#L117-L121`](https://github.com/cweijan/vscode-office/blob/2755c6fb1c17bd35c11295af38a648f4f9917be7/resource/markdown/index.js#L117-L121).
- **Phía mình**: `buildConfigMessage` trong `src/host/config.ts` cộng với options khi render KaTeX trong `math-extension.ts`. LaTeX là thuộc tính của node nên roundtrip không bị ảnh hưởng.
- **Rủi ro**: rất thấp. Nhớ áp dụng cả cho PDF export, vì issue [#359](https://github.com/cweijan/vscode-office/issues/359) (c5) phàn nàn render trong editor và trong PDF khác nhau.

### 13. P2: Fixture cho lỗi khoảng trắng trong ô bảng

- **Là gì**: lỗi của họ: lưu `| a `b` c |` thì mất khoảng trắng trước inline code/bold/link trong ô bảng ([#619](https://github.com/cweijan/vscode-office/issues/619), r1, có repro chi tiết). Cùng nhóm với [#495](https://github.com/cweijan/vscode-office/issues/495) (header bảng bị "căn lại").
- **Phía mình**: có `table-cell-code-span-pipe.md` và `table-cell-escaped-pipe.md`, nhưng chưa có fixture cho mẫu "chữ + khoảng trắng + inline mark" ở đầu ô. Repro trong #619 thêm được thẳng làm `harness/fixtures/synthetic/table-cell-inline-spacing.md` (chỉ chứa input thô). Chi phí gần bằng 0, và bảo vệ được serializer bảng tự viết (`table-markdown-serializer.ts`).

### 14 đến 18. P3

- **14. RTL** ([#486](https://github.com/cweijan/vscode-office/issues/486), r1, vẫn mở): đặt `dir="auto"` cho paragraph/heading/list item thông qua `HTMLAttributes`. Họ chưa làm. Rủi ro nằm ở CSS dùng `left`/`padding-left` cố định (collapse arrow, drag handle, task list).
- **15. i18n**: issue có nhiều reaction nhất trong nhóm liên quan là [#13](https://github.com/cweijan/vscode-office/issues/13) (r11, "How to change language from Chinese?"). Họ dùng `package.nls.*.json` cho 10 ngôn ngữ ([VO `package.nls.json`](https://github.com/cweijan/vscode-office/blob/2755c6fb1c17bd35c11295af38a648f4f9917be7/package.nls.json)). Với mình, bài học ngược lại: giữ UI tiếng Anh nhất quán, và nếu làm thì bắt đầu từ `package.nls` (tên lệnh, setting) trước, chuỗi trong webview sau.
- **16. AI polish**: dùng `vscode.lm.selectChatModels` + `sendRequest`, stream từng chunk về webview, và có panel diff để chấp nhận hoặc từ chối ([VO `markdownEditorProvider.ts#L400-L452`](https://github.com/cweijan/vscode-office/blob/2755c6fb1c17bd35c11295af38a648f4f9917be7/src/provider/markdownEditorProvider.ts#L400-L452), [VO `vditor/src/ts/ui/aiReviewPanel.ts`](https://github.com/cweijan/vscode-office/blob/2755c6fb1c17bd35c11295af38a648f4f9917be7/vditor/src/ts/ui/aiReviewPanel.ts)). `vscode.lm` có sau floor 1.85, nên phải guard bằng `(vscode as any).lm` như họ đang làm, và không có floor check cho nó. Giá trị không chắc chắn, vì Copilot Chat đã làm được việc này trên file text.
- **17. Web extension**: họ có `browser: ./out/extension.web.js` cùng các shim (`src/shims/*`). Host của mình dùng `fs`, `child_process` (clipboard), puppeteer, Node `path`, nên chi phí lớn. Chỉ cân nhắc khi có nhu cầu dùng trên github.dev.
- **18. Chế độ IR**: hiện marker markdown khi con trỏ nằm trong một node ([VO `vditor/src/ts/ir/expandMarker.ts#L118`](https://github.com/cweijan/vscode-office/blob/2755c6fb1c17bd35c11295af38a648f4f9917be7/vditor/src/ts/ir/expandMarker.ts#L118)). Trên ProseMirror, việc này cần decoration/NodeView cho từng mark, và đụng vào decoration nằm trong `.tiptap` đang bị scale (xem AGENTS.md về zoom). Không đáng làm với kiến trúc hiện tại.

## Những điểm mình đã làm tốt hơn, đừng chép

| Vấn đề ở vscode-office | Bằng chứng | Phía mình |
| --- | --- | --- |
| Con trỏ nhảy lên đầu file khi auto-save hoặc gõ nhanh, lặp lại qua nhiều phiên bản | [#353](https://github.com/cweijan/vscode-office/issues/353) (r1, c4), [#158](https://github.com/cweijan/vscode-office/issues/158) (c4), [#570](https://github.com/cweijan/vscode-office/issues/570) (r1), [#631](https://github.com/cweijan/vscode-office/issues/631) ("I want my money back"). Họ vá bằng `isWriteback` + so chuỗi ([VO `documentSync.ts`](https://github.com/cweijan/vscode-office/blob/2755c6fb1c17bd35c11295af38a648f4f9917be7/src/service/markdown/documentSync.ts), [VO `markdownEditorProvider.ts#L222-L229`](https://github.com/cweijan/vscode-office/blob/2755c6fb1c17bd35c11295af38a648f4f9917be7/src/provider/markdownEditorProvider.ts#L222-L229)) và `setValue` thay cả DOM ([VO `index.js#L155-L164`](https://github.com/cweijan/vscode-office/blob/2755c6fb1c17bd35c11295af38a648f4f9917be7/resource/markdown/index.js#L155-L164)) | `contentBaseline` + latch `guardExtensionUpdate` (#111, #148, #150), `withPendingEdit` (#146), `setContent` không recreate, có seam và unit test riêng. Giữ nguyên, và có thể thêm một floor check với `files.autoSave: afterDelay` |
| Thư viện vendored bị cũ, user liên tục đòi nâng cấp mermaid/vditor | [#223](https://github.com/cweijan/vscode-office/issues/223) (r6), [#429](https://github.com/cweijan/vscode-office/issues/429) (r6), [#317](https://github.com/cweijan/vscode-office/issues/317) (r4), [#412](https://github.com/cweijan/vscode-office/issues/412), [#446](https://github.com/cweijan/vscode-office/issues/446), [#64](https://github.com/cweijan/vscode-office/issues/64) | Dependency qua npm cộng roundtrip harness và golden làm cổng kiểm tra trước và sau mỗi lần nâng cấp, mermaid là artifact lazy-load. Đừng vendor bản `.min.js` |
| PDF bị ép chèn TOC vào thân văn bản | [VO `markdown-pdf.js#L53-L63`](https://github.com/cweijan/vscode-office/blob/2755c6fb1c17bd35c11295af38a648f4f9917be7/src/service/markdown/markdown-pdf.js#L53-L63), [#84](https://github.com/cweijan/vscode-office/issues/84), [#105](https://github.com/cweijan/vscode-office/issues/105) | Dùng bookmark native (mục 2), không đụng vào thân văn bản |
| `localResourceRoots` mở cả `/` và mọi ổ đĩa `A:` đến `Z:` | [VO `markdownEditorProvider.ts#L136-L145`](https://github.com/cweijan/vscode-office/blob/2755c6fb1c17bd35c11295af38a648f4f9917be7/src/provider/markdownEditorProvider.ts#L136-L145), [VO `#L112-L121`](https://github.com/cweijan/vscode-office/blob/2755c6fb1c17bd35c11295af38a648f4f9917be7/src/provider/markdownEditorProvider.ts#L112-L121) | Giữ phạm vi hẹp, đừng "sửa ảnh không hiện" bằng cách mở rộng roots |
| Chiếm `Ctrl+V` của text editor markdown để paste ảnh, gây lỗi "command not found" và paste hỏng | keybinding `office.markdown.paste` ([VO `package.json`](https://github.com/cweijan/vscode-office/blob/2755c6fb1c17bd35c11295af38a648f4f9917be7/package.json)), [#371](https://github.com/cweijan/vscode-office/issues/371) (r5, c8), [#375](https://github.com/cweijan/vscode-office/issues/375) (r2) | Không đụng tới text editor. VS Code đã tự paste ảnh vào markdown |
| Tự khôi phục focus khiến con trỏ nhấp nháy và kéo focus từ panel khác về | [#573](https://github.com/cweijan/vscode-office/issues/573) (r2), họ phải thêm setting `restoreViewState` ([VO `package.json#L672`](https://github.com/cweijan/vscode-office/blob/2755c6fb1c17bd35c11295af38a648f4f9917be7/package.json#L672)) | Chỉ có `autofocus: 'start'` một lần. Đây cũng là lý do thêm để giữ quyết định rút #121 |
| Telemetry bật mặc định | [VO `package.json#L804`](https://github.com/cweijan/vscode-office/blob/2755c6fb1c17bd35c11295af38a648f4f9917be7/package.json#L804) | Không có telemetry. Giữ như vậy |
| File dài nhiều code block bị đơ (mỗi block là một CodeMirror) | [#516](https://github.com/cweijan/vscode-office/issues/516) (c4) | Highlight bằng lowlight, không có editor con. Nếu sau này muốn sửa code block "xịn" hơn thì đây là cái bẫy cần tránh |
| Một số tính năng chỉ có ở bản Pro, có user đã mua license | changelog 4.2.1, #516, #631 | Không áp dụng |

**Giới hạn chung của cả hai, đừng hứa với user**: spell check trong webview ([#201](https://github.com/cweijan/vscode-office/issues/201), r2, tác giả từ chối vì "inherently unsupported by VS Code Webview"). Click kết quả Search của VS Code không nhảy tới đúng vị trí, và không đồng bộ cuộn với source, vì VS Code không truyền selection cho custom editor ([#599](https://github.com/cweijan/vscode-office/issues/599), [#203](https://github.com/cweijan/vscode-office/issues/203) c5).

**Những gì họ có mà mình đã có tương đương (không đề xuất)**: wiki link có alias, backlinks (họ không có), TOC có highlight heading đang đọc ([#263](https://github.com/cweijan/vscode-office/issues/263)), resize ảnh ([#186](https://github.com/cweijan/vscode-office/issues/186), [#532](https://github.com/cweijan/vscode-office/issues/532)), mermaid trong PDF ([#395](https://github.com/cweijan/vscode-office/issues/395)), đường dẫn ảnh `/` tính từ gốc workspace ([#33](https://github.com/cweijan/vscode-office/issues/33); mình có ở `src/host/imagePaths.ts:75-79`), `--no-sandbox` khi chạy root trên Linux ([VO `markdownService.ts#L63-L81`](https://github.com/cweijan/vscode-office/blob/2755c6fb1c17bd35c11295af38a648f4f9917be7/src/service/markdownService.ts#L63-L81); mình có `puppeteerLaunchArgs`), focus mode tương đương typewriter mode, theme bám theo light/dark của VS Code (`onDidChangeActiveColorTheme`), flush khi webview bị ẩn.

## Nguồn

- Repo: https://github.com/cweijan/vscode-office, commit `2755c6fb1c17bd35c11295af38a648f4f9917be7` (đã đọc `package.json`, `README.md`, `changelog.md`, `shortcut.md`, `LICENSE`, `src/provider/markdownEditorProvider.ts`, `src/service/markdownService.ts`, `src/service/markdown/*`, `src/common/fileUtil.ts`, `resource/markdown/*.js`, `vditor/package.json`, `vditor/src/ts/*` (danh sách file và một số đoạn trích)).
- Issues: 564 issue, lấy qua `gh api graphql` (mọi trạng thái), lọc 252 issue liên quan tới markdown/ảnh/export/editor, xếp theo reaction và comment. Các issue được trích ở trên đều có link.
- Repo này: `AGENTS.md`, `README.md`, `CHANGELOG.md`, `package.json`, `src/extension.ts`, `src/host/{openWikiLink,openLocalFile,defaultEditor,saveImage,imagePaths,exportDocument,session}.ts`, `src/shared/messages.ts`, `src/webview/{main,content-sync,wiki-link-plugin,slash-command-plugin}.ts`, `src/utils/export-pdf.ts`, `node_modules/puppeteer-core/lib/types.d.ts`.
