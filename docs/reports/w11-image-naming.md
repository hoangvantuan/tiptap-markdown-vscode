# W11-W3: mẫu đường dẫn lưu ảnh (#172) và nhận dạng định dạng qua magic bytes (#177)

Nhánh `wave11/w3-image-naming`, tách từ `develop` tại `f2bd057`. Mọi khối mã dưới đây sinh bằng `sed -n` / `grep`.

## Đã làm

- `src/host/imageName.ts` (mới, thuần): mở rộng mẫu, làm sạch tên tài liệu, các guard.
- `src/host/imageFormat.ts` (mới, thuần): bảng magic bytes PNG/JPEG/GIF/WebP/SVG và `correctExtension`.
- `src/host/saveImage.ts`: ruột `writeImage()` dùng hai module trên. Chữ ký không đổi; JSDoc ghi hợp đồng "filename là tên gợi ý".
- `package.json`: setting mới `tuiMarkdown.imageFileNameTemplate` (mặc định `${name}`); `imageSaveFolder` nhận biến (đổi `description`).
- `src/host/config.ts`: thêm `getImageSaveFolder()` và `getImageFileNameTemplate()` (chỉ thêm).
- `src/webview/main.ts`: chỉ thêm một comment trên `generateImageFilename` (hành vi không đổi).
- Test: `test/image-format.test.ts`, `test/image-name.test.ts`, `test/save-image.test.ts`.

### Biến

Danh sách lấy từ interface (`sed -n '/^export interface TemplateVars/,/^}/p' src/host/imageName.ts`):

```
export interface TemplateVars {
  readonly fileName: string;
  readonly name: string;
  readonly date: string;
  readonly now: string;
  readonly random: string;
  readonly uuid: string;
  readonly ext: string;
}
```

Ngoài tối thiểu (`fileName`, `date`, `now`, `uuid`, `random`, `ext`) có thêm `name` (tên gợi ý bỏ đuôi; với ảnh dán là `image-<now>-<random>` do webview sinh, với ảnh kéo-thả/chọn file là tên file gốc). Không hỗ trợ `${workspaceDir}` (biến lạ bị từ chối, có test).

Mặc định (`grep -n 'DEFAULT_IMAGE_FILENAME_TEMPLATE =\|DEFAULT_IMAGE_SAVE_FOLDER =' src/host/imageName.ts`):

```
29:export const DEFAULT_IMAGE_SAVE_FOLDER = "images";
39:export const DEFAULT_IMAGE_FILENAME_TEMPLATE = "${name}";
```

Mặc định `tuiMarkdown.imageFileNameTemplate` là `${name}`: ảnh dán giữ nguyên `image-<now>-<random>.<ext>` như hôm nay (vì webview vẫn sinh tên gợi ý đó), ảnh kéo-thả `photo.png` (và ảnh chọn từ file picker của W4) giữ nguyên tên gốc `photo.png`. Các biến `${now}`, `${random}`, `${date}`, `${uuid}`, `${fileName}`, `${ext}` sẵn sàng khi người dùng đặt mẫu riêng.

Test ghim hành vi mặc định (`sed -n '142,172p' test/image-name.test.ts`):

```
  it("the default template gives the suggested name back unchanged", () => {
    const cases: Array<[suggested: string, ext: string]> = [
      ["image-1712345678901-k3j9x2.png", "png"], // what the webview generates for a paste
      ["image-1712345678901-k3j9x2.jpeg", "jpeg"],
      ["photo.png", "png"], // a dropped file
      ["My holiday photo.jpg", "jpg"],
      ["a.b.png", "png"],
      ["IMG_0001.PNG", "PNG"],
    ];
    for (const [suggested, ext] of cases) {
      const r = expandFileName(DEFAULT_IMAGE_FILENAME_TEMPLATE, vars("Notes.md", suggested, ext));
      assert.ok(r.ok);
      assert.equal(r.value, suggested);
    }
  });

  it("package.json declares the same defaults as the code falls back to", () => {
    // `npm test` runs from the repo root. Two copies of a default drift; this
    // is what keeps the Settings UI and the blank-setting fallback in step.
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
    const props = pkg.contributes.configuration.properties;
    assert.equal(props["tuiMarkdown.imageFileNameTemplate"].default, DEFAULT_IMAGE_FILENAME_TEMPLATE);
    assert.equal(props["tuiMarkdown.imageSaveFolder"].default, DEFAULT_IMAGE_SAVE_FOLDER);
  });

  it("the default template is ${name}, and ${now}/${random} stay available to a user template", () => {
    assert.equal(DEFAULT_IMAGE_FILENAME_TEMPLATE, "${name}");
    const r = expandFileName("image-${now}-${random}", vars());
    assert.ok(r.ok);
    assert.match(r.value, /^image-\d+-[0-9a-z]{6}\.png$/);
  });
```

### Quy tắc mở rộng

```
/**
 * Make `raw` safe as ONE path segment: separators and reserved characters
 * become `_`, no `..` survives, trailing dots and spaces (which Windows drops
 * silently) go, and a device name gets a `_` prefix. Never empty.
 */
export function sanitizeNameSegment(raw: string): string {
  let s = raw.replace(UNSAFE_SEGMENT_CHARS, "_");
  s = s.replace(/\.{2,}/g, "_");
  s = s.replace(/[. ]+$/, "").trim();
  if (s === "") return "untitled";
  if (RESERVED_NAMES.test(s)) s = `_${s}`;
  return s;
}

export function expandTemplate(template: string, vars: TemplateVars): Expansion {
  let unknown: string | undefined;
  const value = template.replace(/\$\{([^}]*)\}/g, (_m, key: string) => {
    if (Object.prototype.hasOwnProperty.call(vars, key)) return vars[key as keyof TemplateVars];
    unknown ??= key;
    return "";
  });
  if (unknown !== undefined) return { ok: false, error: `Unknown variable \${${unknown}}` };
  return { ok: true, value };
}

/**
 * The file name for `template`. `.ext` is appended unless the template spells
 * `${ext}` itself, so `image-${now}` and `image-${now}.${ext}` mean the same.
 */
export function expandFileName(template: string, vars: TemplateVars): Expansion {
  const expanded = expandTemplate(template, vars);
  if (!expanded.ok) return expanded;
  const spellsExt = /\$\{ext\}/.test(template);
  return { ok: true, value: spellsExt ? expanded.value : `${expanded.value}.${vars.ext}` };
}
```

- Biến lạ là LỖI (không ghi literal), thư mục KHÔNG được tạo.
- `.ext` tự nối trừ khi mẫu có `${ext}`.
- Tên đã tồn tại thì thêm `-2`, `-3`... (trước đây kéo-thả file trùng tên ghi đè lặng lẽ; đây là bản sửa lỗi). Các lần `writeImage` đồng thời được xếp hàng (`writeQueue`) để không chọn trùng tên.
- Dấu `/` cuối trong thư mục được bỏ (`images/` không còn cho `images//x.png`).

### Thứ tự guard trong `writeImage` (chạy trên KẾT QUẢ mở rộng)

```
9: * containing `..`; and the joined folder is re-checked with `path.relative`
62:let writeQueue: Promise<unknown> = Promise.resolve();
83:  const run = writeQueue.then(() => writeImageNow(document, filename, bytes));
84:  writeQueue = run.catch(() => undefined);
104:  if (!isValidImageFilename(filename)) {
121:    const folderExpansion = expandTemplate(getImageSaveFolder(), vars);
127:    const folderError = checkSaveFolder(saveFolder);
133:    // Resolve folder path relative to document
138:    const rel = path.relative(documentFolder.fsPath, imageFolder.fsPath);
147:    const nameExpansion = expandFileName(getImageFileNameTemplate(), vars);
152:    if (!isValidImageFilename(nameExpansion.value)) {
167:      finalName = withSuffix(nameExpansion.value, n);
```

Guard cũ giữ nguyên: tên gợi ý bị kiểm như trước; thư mục tuyệt đối / `..`; `path.relative` so với thư mục tài liệu; tên cuối cùng (`..`, `/`, `\`, ký tự cấm, tên thiết bị Windows). `fileName` và `name` còn được làm sạch ngay từ đầu.

### #177

```
export function detectImageFormat(bytes: Uint8Array): ImageFormat | undefined {
  if (startsWith(bytes, PNG_SIG)) return PNG;
  if (startsWith(bytes, JPEG_SIG)) return JPEG;
  if (startsWith(bytes, GIF87) || startsWith(bytes, GIF89)) return GIF;
  // WebP is a RIFF container: "RIFF", a 4-byte size, then "WEBP".
  if (startsWith(bytes, RIFF) && startsWith(bytes, WEBP_TAG, 8)) return WEBP;
  if (looksLikeSvg(bytes)) return SVG;
  return undefined;
}

/**
 * The extension to save `bytes` under, given the one the caller suggested
 * (no dot; may be empty).
export function correctExtension(suggestedExt: string, bytes: Uint8Array): string {
  const detected = detectImageFormat(bytes);
  if (!detected) return suggestedExt || "png";
  if (detected.aliases.includes(suggestedExt.toLowerCase())) return suggestedExt;
  return detected.ext;
}
```

Phần mở rộng đúng (kể cả `.jpeg`, hoa/thường) giữ nguyên; sai thì sửa; byte lạ thì giữ gợi ý; không có gợi ý và byte lạ thì `png`. SVG nhận `<svg` hoặc `<?xml` sau BOM/khoảng trắng (đúng như TASK; `<?xml` không kiểm thêm gốc `<svg`, nên một XML không phải SVG gắn nhãn `image/*` sẽ thành `.svg`; chấp nhận, ghi trong comment đầu file).

## Kiểm chứng

Lệnh và output thật (lượt cuối, sau commit `608cec8`):

```
$ npm run lint            -> sạch (tsc --noEmit)
$ npm run build           -> Build complete (production); webview bundle: 1028747 B / 1100000 B budget (không đổi so với mốc)
$ npm test                -> ℹ tests 166 / ℹ pass 166 / ℹ fail 0     (mốc 98; thêm 68)
$ npm run roundtrip       -> 45 markdown fixtures + 21 seams: 66 passed, 0 failed, 0 missing, 0 errored
vòng hai + khôi phục      -> 66 passed, 0 failed, 0 missing, 0 errored; git status --short harness/ rỗng
floor                     -> 63 checks: 63 passed, 0 failed
```

```
$ MB=$(git merge-base develop HEAD); git diff $MB..HEAD --stat -- harness/fixtures/synthetic/
(rỗng: không đụng fixture nào)
```

### Răng (ràng buộc 9)

Mỗi dòng: phá MỘT chỗ trong file mang cơ chế, chạy `npm test`, khôi phục bằng `git checkout -- <file>`. "đỏ" là số ca lá (dòng `ℹ fail`), mốc là 166 pass / 0 fail. Script dùng: `/tmp/w3teeth/run.sh` (không commit; nội dung ở cuối mục).

| Phá cái gì | File | Đỏ |
|---|---|---|
| chữ ký WebP không bao giờ khớp | imageFormat.ts | 7 |
| `correctExtension` luôn giữ gợi ý | imageFormat.ts | 5 |
| SVG không bao giờ nhận | imageFormat.ts | 3 |
| đổi `DEFAULT_IMAGE_FILENAME_TEMPLATE` khỏi `${name}` | imageName.ts | 12 |
| `default` trong `package.json` lệch khỏi hằng số mã | package.json | 1 |
| biến `name` không lấy từ `suggestedName` | imageName.ts | 12 |
| bỏ thay `..` trong `sanitizeNameSegment` | imageName.ts | 3 |
| bỏ thay dấu phân cách / ký tự cấm | imageName.ts | 6 |
| bỏ tiền tố `_` cho tên thiết bị | imageName.ts | 2 |
| biến lạ thành chuỗi rỗng | imageName.ts | 2 |
| luôn nối `.ext` | imageName.ts | 3 |
| tắt guard thư mục | imageName.ts | 3 |
| tắt guard tên file | imageName.ts | 5 |
| ngày sai tháng | imageName.ts | 2 |
| bỏ guard tên đã mở rộng | saveImage.ts | 3 |
| bỏ guard thư mục đã mở rộng | saveImage.ts | 1 |
| **tắt kiểm `path.relative`** | saveImage.ts | **0** |
| bỏ vòng chống đụng tên | saveImage.ts | 3 |
| bỏ hàng đợi ghi | saveImage.ts | 1 |
| không sửa phần mở rộng theo byte | saveImage.ts | 4 |
| `fileName` lấy sai nguồn | saveImage.ts | 7 |
| bỏ qua mẫu tên file (luôn dùng `${name}`) | saveImage.ts | 9 |
| bỏ qua mẫu tên file (luôn dùng tên cố định) | saveImage.ts | 18 |
| (rủi ro ledger) tắt điều kiện "cùng thư mục" của rename | image-rename-handler.ts | 7 (2 là test mới) |
| (rủi ro ledger) tắt phát hiện delete | image-rename-handler.ts | 11 (2 là test mới) |
| (rủi ro ledger) rename không cần cùng thư mục | image-rename-handler.ts | 1 (test mới) |

**Số 0 đã báo:** kiểm `path.relative` trong `writeImage` là lớp phòng thủ thứ hai đã có từ trước và KHÔNG sửa. Kiểm chuỗi (`checkSaveFolder`) chặn mọi đầu vào trên Linux trước khi tới nó; chưa dựng được ca nào chỉ nó bắt (chỉ có thể là liên kết tượng trưng hoặc chuỗi kiểu ổ đĩa Windows, chưa kiểm được trên máy này). Nó không được test riêng.

Nội dung script:

```
#!/bin/bash
# usage: run.sh <label> <file> <python-replace-old> <new>
cd /home/tuanhv/.paseo/worktrees/3t05p45h/w11-image-naming
label="$1"; file="$2"
python3 - "$file" "$3" "$4" <<'PY'
import sys
f,old,new=sys.argv[1:4]
s=open(f).read()
assert old in s, "pattern not found: "+old
open(f,'w').write(s.replace(old,new,1))
PY
[ $? -ne 0 ] && { echo "$label: PATTERN MISSING"; git checkout -- "$file"; exit 1; }
out=$(npm test 2>&1)
fail=$(echo "$out" | grep -E "^ℹ fail" ); pass=$(echo "$out" | grep -E "^ℹ pass")
echo "== $label ($file): $pass | $fail"
echo "$out" | grep -E "^\s+✖" | grep -v "▶" | sed 's/ ([0-9.]*ms)//' | sort -u | head -40
git checkout -- "$file"
```

### Rủi ro ImageLedger / auto-rename / auto-delete (đo, không đoán)

`test/save-image.test.ts`, nhóm "a per-document folder and the auto-rename / auto-delete machinery": với `imageSaveFolder = images/${fileName}`:

- đổi tên ảnh trong cùng thư mục `images/note/` được nhận là rename (`ImageLedger.detectRenames`), kể cả tên tài liệu có dấu cách (đường dẫn bọc `<...>`);
- chuyển ảnh sang thư mục khác KHÔNG là rename (luật cũ còn nguyên);
- xoá ảnh khỏi markdown được nhận là delete (`ledger.detectDeletes`);
- hai tài liệu cùng mẫu có thư mục riêng.

Kết luận: không phát hiện hồi quy; luật "thư mục giữ nguyên" so thư mục ĐÃ mở rộng nằm trong chính đường dẫn markdown nên thư mục theo tài liệu không làm nó hỏng. Một lưu ý đọc từ mã (không có test riêng): `detectImageDeletes` coi ảnh là "đã chuyển" khi một ảnh KHÁC thư mục cùng basename còn trong tài liệu. Mẫu tên không có `${now}`/`${random}` (vd `image` + thư mục `.`) kết hợp hậu tố `-2` vẫn cho basename khác nhau nên không đụng; nhưng người dùng đặt cùng basename ở hai thư mục khác nhau trong một tài liệu thì xoá một ảnh sẽ không bị nhận là delete (hành vi cũ, không do thay đổi này).

## Tiêu chí CHƯA kiểm được

- Chạy thật trong VS Code (dán/thả ảnh qua webview rồi xem markdown nhận `savedPath`): floor hiện không có check nào đi qua `saveImage`, nên đường webview → host → `imageSaved` chưa được kiểm tự động. Chỉ kiểm qua `writeImage` với stub `vscode` (ghi đĩa thật).
- Hành vi trên Windows (tên thiết bị, ổ đĩa): chỉ kiểm bằng chuỗi/regex, chưa chạy trên Windows.
- `path.relative` guard (xem trên).

## Câu chữ đề xuất cho tài liệu gốc

**CHANGELOG `## [Unreleased]`**

```
### Added
- `tuiMarkdown.imageFileNameTemplate`: name pasted and dropped images from a template (default `${name}`, keeping both the generated `image-<now>-<random>` name for pastes and the original file name for dropped/picked images). `tuiMarkdown.imageSaveFolder` accepts the same variables, e.g. `images/${fileName}` for one folder per document. Variables: `${fileName}`, `${name}`, `${date}`, `${now}`, `${random}`, `${uuid}`, `${ext}`. `${workspaceDir}` is not supported: the image folder must stay inside the document's folder (#172)
- The image extension is taken from the file's content (PNG, JPEG, GIF, WebP, SVG) instead of its label, so a WebP the clipboard calls `image/png` is saved as `.webp` (#177)

### Fixed
- Saving a pasted or dropped image whose file name already exists in the destination folder now appends `-2`, `-3`... instead of silently overwriting the existing file (#172)
```

**README** (tuỳ chọn, bảng cài đặt, cạnh dòng `tuiMarkdown.imageSaveFolder`):

```
| `tuiMarkdown.imageSaveFolder`       | `images`  | Folder for pasted images (relative to document). Accepts variables, e.g. `images/${fileName}` |
| `tuiMarkdown.imageFileNameTemplate` | `${name}` | File name for pasted/dropped images, without extension. Variables: `${fileName}` `${name}` `${date}` `${now}` `${random}` `${uuid}` `${ext}` |
```

**AGENTS.md**: thêm vào cây `src/host/`:

```
│   ├── imageName.ts          # Pure: expand imageSaveFolder / imageFileNameTemplate variables, sanitise a document name into one path segment, the filename/folder guards (#172)
│   ├── imageFormat.ts        # Pure: magic-byte table (PNG/JPEG/GIF/WebP/SVG) and correctExtension (#177)
```

và vào mục Configuration Settings: dòng `imageFileNameTemplate` (default: `${name}`) như trên; ghi quy ước: "`writeImage`'s `filename` is a suggestion; callers use the returned `relativePath`/`fileUri`; every guard runs on the expanded value; `${workspaceDir}` is deliberately unsupported".

## Đặc tả floor check đề xuất

Vì floor chưa có check nào đi qua `saveImage` (ràng buộc 8, tôi không thêm):

- **Thao tác:** trong host của floor, đặt `tuiMarkdown.imageSaveFolder = "images/${fileName}"` ở workspace, mở một `.md`, gửi từ webview một message `saveImage` với `data` là base64 của một ảnh WebP nhỏ và `filename: "x.png"`.
- **Đọc:** message `imageSaved` trả về (`savedPath`) và thư mục `images/<tên tài liệu>/` trên đĩa.
- **Khẳng định:** `savedPath` là `images/<tên tài liệu>/x.webp`; file tồn tại ở đó và nội dung bằng byte đã gửi; không có file nào ở `images/` gốc.
- **Phá thì phải đỏ:** làm `writeImage` bỏ qua mẫu (về `images/`), hoặc bỏ `correctExtension` (ra `.png`).
