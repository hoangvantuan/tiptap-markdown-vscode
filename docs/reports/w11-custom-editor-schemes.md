# W11 / O2 — #169 `customEditors`: allowlist scheme thay cho denylist scheme diff

Cánh chánh: `wave11/o2-editor-schemes`, tách từ `develop` @ `f2bd057`.

## 1. Thay đổi

Đúng hai khối được sở hữu, không đụng khối khác của `package.json`:

- `contributes.customEditors[].selector`: `*.md` / `*.markdown` (mọi scheme) → allowlist 4 scheme,
  cả `.md` lẫn `.markdown`.
- `contributes.configurationDefaults`: **không đổi** (denylist `{git,gitlens,git-graph}:` giữ nguyên
  làm lớp thứ hai, theo quyết định đã có).

`sed -n '142,175p' package.json` (sau thay đổi):

```
    "customEditors": [
      {
        "viewType": "tuiMarkdown.editor",
        "displayName": "Tiptap Markdown Editor",
        "selector": [
          {
            "filenamePattern": "file:/**/*.md"
          },
          {
            "filenamePattern": "file:/**/*.markdown"
          },
          {
            "filenamePattern": "vscode-remote:/**/*.md"
          },
          {
            "filenamePattern": "vscode-remote:/**/*.markdown"
          },
          {
            "filenamePattern": "vscode-vfs:/**/*.md"
          },
          {
            "filenamePattern": "vscode-vfs:/**/*.markdown"
          },
          {
            "filenamePattern": "untitled:/**/*.md"
          },
          {
            "filenamePattern": "untitled:/**/*.markdown"
          }
        ],
        "priority": "default"
      }
    ],
    "configurationDefaults": {
```

`git diff $(git merge-base develop HEAD)..HEAD -- package.json`:

```diff
     "customEditors": [
       {
         "viewType": "tuiMarkdown.editor",
         "displayName": "Tiptap Markdown Editor",
         "selector": [
           {
-            "filenamePattern": "*.md"
+            "filenamePattern": "file:/**/*.md"
           },
           {
-            "filenamePattern": "*.markdown"
+            "filenamePattern": "file:/**/*.markdown"
+          },
+          {
+            "filenamePattern": "vscode-remote:/**/*.md"
+          },
+          {
+            "filenamePattern": "vscode-remote:/**/*.markdown"
+          },
+          {
+            "filenamePattern": "vscode-vfs:/**/*.md"
+          },
+          {
+            "filenamePattern": "vscode-vfs:/**/*.markdown"
+          },
+          {
+            "filenamePattern": "untitled:/**/*.md"
+          },
+          {
+            "filenamePattern": "untitled:/**/*.markdown"
           }
         ],
         "priority": "default"
```

Không có file `.ts` nào của extension bị sửa: selector nằm trong manifest, không ai trong `src/`
đọc nó. Bằng chứng:

```
$ grep -rn "filenamePattern" --include=*.ts . | grep -v node_modules | grep -v "^./out/"
(rỗng, exit=1)
```

## 2. Nguồn: cú pháp `filenamePattern` CÓ scheme, và scheme được đưa vào đích so khớp

Nguồn: VS Code **1.85.0** (đúng `engines.vscode` của repo), tải
`https://github.com/microsoft/vscode/archive/refs/tags/1.85.0.tar.gz`.

`sed -n '210,224p' src/vs/workbench/services/editor/common/editorResolverService.ts`:

```ts
export function globMatchesResource(globPattern: string | glob.IRelativePattern, resource: URI): boolean {
	const excludedSchemes = new Set([
		Schemas.extension,
		Schemas.webviewPanel,
		Schemas.vscodeWorkspaceTrust,
		Schemas.vscodeSettings
	]);
	// We want to say that the above schemes match no glob patterns
	if (excludedSchemes.has(resource.scheme)) {
		return false;
	}
	const matchOnPath = typeof globPattern === 'string' && globPattern.indexOf(posix.sep) >= 0;
	const target = matchOnPath ? `${resource.scheme}:${resource.path}` : basename(resource);
	return glob.match(typeof globPattern === 'string' ? globPattern.toLowerCase() : globPattern, target.toLowerCase());
}
```

Đây là câu trả lời cho TASK.md điểm 1, và nó cũng là LÝ DO issue đúng: `*.md` không chứa `/`, nên
target là **basename**, và `*.md` khớp **mọi** scheme. Chỉ khi pattern chứa `/` thì target mới là
`scheme:path`. Selector của `customEditors` đi đúng đường này:

`src/vs/workbench/contrib/customEditor/browser/customEditors.ts` (`sed -n '112,124p'`):

```ts
		// Clear all previous contributions we know
		this._editorResolverDisposables.clear();

		for (const contributedEditor of this._contributedEditors) {
			for (const globPattern of contributedEditor.selector) {
				if (!globPattern.filenamePattern) {
					continue;
				}

				this._editorResolverDisposables.add(this.editorResolverService.registerEditor(
					globPattern.filenamePattern,
					{
						id: contributedEditor.id,
```

`src/vs/workbench/contrib/customEditor/common/customEditor.ts` (`sed -n '110,112p'`):

```ts
	matches(resource: URI): boolean {
		return this.selector.some(selector => selector.filenamePattern && globMatchesResource(selector.filenamePattern, resource));
	}
```

Trong 1.85 selector chỉ có **một** khoá được schema chấp nhận, `filenamePattern`
(`extensionPoint.ts`, `items.properties` chỉ liệt kê `filenamePattern`; không có khoá `scheme` —
khoá `scheme` trong `editorAssociations` là của bản VS Code mới hơn, đừng lẫn). Vì vậy allowlist
bắt buộc phải viết scheme vào trong chính glob.

## 3. ĐO (không đoán)

### 3.1 Bảng khớp, chạy bằng glob của chính VS Code 1.85

Harness: `/tmp/opencode/globtest2.ts` — copy nguyên văn `globMatchesResource` ở trên, import
`vs/base/common/glob` của 1.85 qua alias esbuild:

```
cd /home/tuanhv/.paseo/worktrees/3t05p45h/w11-editor-schemes
./node_modules/.bin/esbuild --bundle --platform=node --format=cjs \
  --outfile=/tmp/opencode/globtest2.js \
  --alias:vs=/tmp/opencode/vsrc/vscode-1.85.0/src/vs /tmp/opencode/globtest2.ts
node /tmp/opencode/globtest2.js
```

Output thật (cột 0–3 là pattern **đã ship**, cột 4–7 là những cách viết sai dễ mắc, để thấy bảng
có răng):

```
file://:/home/u/notes/readme.md                file:/**/*.md=Y vscode-remote:/**/*.md=. vscode-vfs:/**/*.md=. untitled:/**/*.md=. untitled:/*.md=. file:*/*.md=. vscode-remote:**/*.md=. untitled:Untitled-*=.
file://:/readme.md                             file:/**/*.md=Y vscode-remote:/**/*.md=. vscode-vfs:/**/*.md=. untitled:/**/*.md=. untitled:/*.md=. file:*/*.md=Y vscode-remote:**/*.md=. untitled:Untitled-*=.
vscode-remote://:/home/u/notes/readme.md       file:/**/*.md=. vscode-remote:/**/*.md=Y vscode-vfs:/**/*.md=. untitled:/**/*.md=. untitled:/*.md=. file:*/*.md=. vscode-remote:**/*.md=. untitled:Untitled-*=.
vscode-remote://ssh-remote+build-01:/home/u/notes/readme.md file:/**/*.md=. vscode-remote:/**/*.md=Y vscode-vfs:/**/*.md=. untitled:/**/*.md=. untitled:/*.md=. file:*/*.md=. vscode-remote:**/*.md=. untitled:Untitled-*=.
vscode-vfs://github:/user/repo/x.md            file:/**/*.md=. vscode-remote:/**/*.md=. vscode-vfs:/**/*.md=Y untitled:/**/*.md=. untitled:/*.md=. file:*/*.md=. vscode-remote:**/*.md=. untitled:Untitled-*=.
vscode-vfs://:/github/user/repo/readme.md      file:/**/*.md=. vscode-remote:/**/*.md=. vscode-vfs:/**/*.md=Y untitled:/**/*.md=. untitled:/*.md=. file:*/*.md=. vscode-remote:**/*.md=. untitled:Untitled-*=.
vscode-remote://:/home/u/notes/readme.markdown file:/**/*.md=. vscode-remote:/**/*.md=. vscode-vfs:/**/*.md=. untitled:/**/*.md=. untitled:/*.md=. file:*/*.md=. vscode-remote:**/*.md=. untitled:Untitled-*=.
untitled://:Untitled-1                         file:/**/*.md=. vscode-remote:/**/*.md=. vscode-vfs:/**/*.md=. untitled:/**/*.md=. untitled:/*.md=. file:*/*.md=. vscode-remote:**/*.md=. untitled:Untitled-*=.
untitled://:/home/u/notes/readme.md            file:/**/*.md=. vscode-remote:/**/*.md=. vscode-vfs:/**/*.md=. untitled:/**/*.md=Y untitled:/*.md=. file:*/*.md=. vscode-remote:**/*.md=. untitled:Untitled-*=.
untitled://:/readme.md                         file:/**/*.md=. vscode-remote:/**/*.md=. vscode-vfs:/**/*.md=. untitled:/**/*.md=Y untitled:/*.md=Y file:*/*.md=. vscode-remote:**/*.md=. untitled:Untitled-*=.
git://:/repo/notes/readme.md                   file:/**/*.md=. vscode-remote:/**/*.md=. vscode-vfs:/**/*.md=. untitled:/**/*.md=. untitled:/*.md=. file:*/*.md=. vscode-remote:**/*.md=. untitled:Untitled-*=.
review://:/repo/notes/readme.md                file:/**/*.md=. vscode-remote:/**/*.md=. vscode-vfs:/**/*.md=. untitled:/**/*.md=. untitled:/*.md=. file:*/*.md=. vscode-remote:**/*.md=. untitled:Untitled-*=.
cline://:/repo/notes/readme.md                 file:/**/*.md=. vscode-remote:/**/*.md=. vscode-vfs:/**/*.md=. untitled:/**/*.md=. untitled:/*.md=. file:*/*.md=. vscode-remote:**/*.md=. untitled:Untitled-*=.
vscode-userdata://:/User/settings.md           file:/**/*.md=. vscode-remote:/**/*.md=. vscode-vfs:/**/*.md=. untitled:/**/*.md=. untitled:/*.md=. file:*/*.md=. vscode-remote:**/*.md=. untitled:Untitled-*=.

columns: [0]file:/**/*.md [1]vscode-remote:/**/*.md [2]vscode-vfs:/**/*.md [3]untitled:/**/*.md [4]untitled:/*.md [5]file:*/*.md [6]vscode-remote:**/*.md [7]untitled:Untitled-*
```

Đọc ra:

- `file:/**/*.md` khớp `file:` ở **cả** gốc (`/readme.md`) lẫn sâu. Authority KHÔNG nằm trong target,
  nên `vscode-remote://ssh-remote+build-01:/home/u/notes/readme.md` vẫn khớp `vscode-remote:/**/*.md`
  (hàng 4) — tài liệu SSH/WSL/codespaces vẫn mở WYSIWYG.
- `git:`, `review:`, `cline:`, `vscode-userdata:` không khớp pattern nào (các hàng cuối, toàn `.`).
  Đây là mục tiêu của #169.
- Cột sai đã làm đỏ: `file:*/*.md` (`*` không qua dấu `/`) chỉ khớp `/readme.md`;
  `vscode-remote:**/*.md` (thiếu `/` ngay sau scheme ⇒ **không** chứa `/` nên bị so với basename)
  không khớp gì.

### 3.2 `untitled:` — chính xác nó khớp cái gì (TASK điểm 1 và 4)

Hình dạng thật của tài liệu chưa lưu, lấy từ 1.85
(`src/vs/workbench/services/untitled/common/untitledTextEditorService.ts`, `sed -n '228,242p'`):

```ts
	private doCreate(options: IInternalUntitledTextEditorOptions): UntitledTextEditorModel {

		// Create new untitled resource if none is provided
		let untitledResource = options.untitledResource;
		if (!untitledResource) {
			let counter = 1;
			do {
				untitledResource = URI.from({ scheme: Schemas.untitled, path: `Untitled-${counter}` });
				counter++;
			} while (this.mapResourceToModel.has(untitledResource));
		}
```

→ resource là **`untitled:Untitled-1`**: path KHÔNG có dấu `/` ở đầu, và KHÔNG có đuôi `.md`.

Hệ quả đo được ở hàng `untitled://:Untitled-1` của bảng §3.1: **không** `filenamePattern` nào khớp
nó — kể cả `*.md` của bản cũ (basename `Untitled-1`), kể cả `untitled:/*.md`, kể cả
`untitled:/Untitled-*` (đã thử ở lượt đo đầu, cột `.`). Nghĩa là **tài liệu `Untitled-N` chưa lưu vốn
đã không mở WYSIWYG**, và sau thay đổi này vẫn không: hành vi được giữ nguyên, không phải hồi quy.

Đo lại bằng floor thật (xem §3.3): `untitled(untitled:Untitled-1)=text` ở CẢ HAI vế.

Trường hợp `untitled:` **có** ý nghĩa là tài liệu untitled GẮN một đường dẫn liên kết
(`IUntitledTextEditorOptions.associatedResource`), và 1.85 đặt đường dẫn đó vào `path` của một URI
vẫn còn scheme `untitled` (`untitledTextEditorService.ts`, `sed -n '192,208p'`):

```ts
	private massageOptions(options: IInternalUntitledTextEditorOptions): IInternalUntitledTextEditorOptions {
		const massagedOptions: IInternalUntitledTextEditorOptions = Object.create(null);

		// Figure out associated and untitled resource
		if (options.associatedResource) {
			massagedOptions.untitledResource = URI.from({
				scheme: Schemas.untitled,
				authority: options.associatedResource.authority,
				fragment: options.associatedResource.fragment,
				path: options.associatedResource.path,
				query: options.associatedResource.query
			});
			massagedOptions.associatedResource = options.associatedResource;
		} else {
			if (options.untitledResource?.scheme === Schemas.untitled) {
				massagedOptions.untitledResource = options.untitledResource;
			}
```

Path đó là một path thật, nhiều đoạn (`/home/u/notes/readme.md`), và `*.md` cũ khớp nó qua basename.
Đó là hành vi cần giữ, nên `untitled:` phải có mặt trong allowlist.

**Sửa chính xác trong lúc làm:** commit đầu viết `untitled:/*.md`. Bảng §3.1 cho thấy `*` không qua
dấu `/`, nên pattern đó chỉ khớp `untitled:/readme.md` và **hỏng** `untitled:/home/u/notes/readme.md`
(hàng `untitled://:/home/u/notes/readme.md`, cột `[4]untitled:/*.md` = `.`). Đã đổi sang
`untitled:/**/*.md` ở commit `d1ea9ca`.

### 3.3 Floor: đo trước / sau trên VS Code sàn thật

Tôi đã tạm thêm một probe đo vào `harness/vscode-floor/extension-tests.ts` (đăng ký
`TextDocumentContentProvider` cho scheme `cline`, mở nó bằng `vscode.open`, đọc
`activeTab.input.viewType`), chạy floor, rồi **gỡ trước khi commit** (`git checkout --
harness/vscode-floor/extension-tests.ts`; `git status --short` sạch). Lệnh floor của COMMON:

```
PUPPETEER_EXECUTABLE_PATH=$HOME/.cache/puppeteer-floor/chrome-nosandbox \
  xvfb-run -a -s "-screen 0 1920x1080x24" npm run verify:vscode-floor
```

**TRƯỚC** thay đổi (`*.md` / `*.markdown`), 64 checks: 64 passed:

```
PASS  TEMP #169 scheme probe — cline-noSetting=tuiMarkdown.editor cline-withAssoc=tuiMarkdown.editor untitled(untitled:Untitled-1)=text
PASS  a diff of two .md files opens as a diff editor, not this custom editor — noSetting=diff "*.md":"tuiMarkdown.editor"=diff; Git Graph's own diff view is NOT covered here and stays a hand check
PASS  workbench.editorAssociations decides which editor opens .md — noSetting=tuiMarkdown.editor "*.md":"default"=text "*.md":"tuiMarkdown.editor"=tuiMarkdown.editor
64 checks: 64 passed, 0 failed
```

**SAU** thay đổi, 64 checks: 64 passed:

```
PASS  TEMP #169 scheme probe — cline-noSetting=text cline-withAssoc=tuiMarkdown.editor untitled(untitled:Untitled-1)=text
PASS  a diff of two .md files opens as a diff editor, not this custom editor — noSetting=diff "*.md":"tuiMarkdown.editor"=diff; Git Graph's own diff view is NOT covered here and stays a hand check
PASS  workbench.editorAssociations decides which editor opens .md — noSetting=tuiMarkdown.editor "*.md":"default"=text "*.md":"tuiMarkdown.editor"=tuiMarkdown.editor
64 checks: 64 passed, 0 failed
```

Đọc ra:

- `cline-noSetting` đổi `tuiMarkdown.editor` → `text`. **#169 đạt mục tiêu**: một tài liệu markdown
  ảo của agent/PR review giờ mở bằng text editor, không còn bị extension giành. Đây cũng là phép
  thử **có răng** của thay đổi này: cùng một probe, cùng một host, chỉ khác `package.json`, và hai
  lần đọc khác nhau. (Số ca đỏ nếu đo sai: 1/1 — trước khi đổi, kỳ vọng "allowlist" là đỏ.)
- Hai check phải giữ xanh của TASK điểm 2 đều xanh ở cả hai vế:
  `a diff of two .md files opens as a diff editor, not this custom editor` và
  `workbench.editorAssociations decides which editor opens .md` (`noSetting=tuiMarkdown.editor`
  chứng minh `file:` vẫn vào custom editor).
- `untitled(untitled:Untitled-1)=text` ở cả hai vế ⇒ không hồi quy cho tài liệu chưa lưu (xem §3.2).

## 4. `tuiMarkdown.useAsDefaultEditor` CÓ vô hiệu allowlist — cần quyết định (TASK điểm 3)

Đo: `cline-withAssoc=tuiMarkdown.editor` ở vế SAU. Nghĩa là khi workspace có
`"*.md": "tuiMarkdown.editor"` (đúng thứ lệnh #122 ghi), một tài liệu `cline:` **vẫn** mở WYSIWYG,
tức allowlist bị vượt. Nguồn, 1.85 `editorResolverService.ts` (`sed -n '346,357p'`):

```ts
	private findMatchingEditors(resource: URI): RegisteredEditor[] {
		// The user setting should be respected even if the editor doesn't specify that resource in package.json
		const userSettings = this.getAssociationsForResource(resource);
		const matchingEditors: RegisteredEditor[] = [];
		// Then all glob patterns
		for (const [key, editors] of this._flattenedEditors) {
			for (const editor of editors) {
				const foundInSettings = userSettings.find(setting => setting.viewType === editor.editorInfo.id);
				if ((foundInSettings && editor.editorInfo.priority !== RegisteredEditorPriority.exclusive) || globMatchesResource(key, resource)) {
					matchingEditors.push(editor);
				}
			}
		}
```

Cơ chế: `*.md` không chứa `/` nên nó là một association theo **basename**, khớp `cline:/repo/notes/readme.md`; và
association của người dùng được coi là **đẳng cấp với selector của extension** ("the user setting should be
respected even if the editor doesn't specify that resource in package.json"). Cùng cơ chế đó giải thích vì
sao `a diff of two .md files…` vẫn xanh: diff đi qua nhánh riêng và không bị association kéo sang.

Đây **không phải** hồi quy do #169 gây ra — trước thay đổi, `cline:` cũng mở WYSIWYG với association đó
(vế `cline-withAssoc` ở cả hai lần đo đều là `tuiMarkdown.editor`). Nhưng allowlist chỉ là **mặc định**,
nó không tự bảo vệ trước một association do chính lệnh của extension này ghi ra. Theo TASK, tôi dừng ở
đây và hỏi, chưa sửa `src/host/defaultEditor.ts`.

Ba phương án, đều là việc sửa `src/host/defaultEditor.ts` + `test/default-editor.test.ts`
(test đó khẳng định đúng JSON mà lệnh ghi ra):

- **A — không sửa gì.** Allowlist là mặc định; một `*.md → tuiMarkdown.editor` do chính người dùng (hoặc
  do lệnh #122) đặt vẫn thắng, đúng như VS Code thiết kế và đúng như trước #169. Chỉ ghi rõ trong
  CHANGELOG.
- **B — `useAsDefaultEditor` ghi association CÓ SCHEME** (`file:/**/*.md`, `vscode-remote:/**/*.md`,
  `vscode-vfs:/**/*.md`, `untitled:/**/*.md` thay cho `*.md`), và `getCurrentWorkspaceMode` đọc được cả
  dạng cũ. Chặn được việc vượt allowlist. Đổi hợp đồng của lệnh #122: một workspace đã có
  `*.md: tuiMarkdown.editor` từ trước sẽ không còn được lệnh nhận ra là "wysiwyg" (trừ khi ta dạy nó đọc
  cả hai dạng, nhưng khi đó lệnh "Reset" cũng phải xoá cả hai).
- **C — B, cộng gỡ khóa `*.md`/`*.markdown` cũ mà chính lệnh này đã ghi.** Sạch nhất về hành vi, nhưng
  là động vào khóa cấu hình trong settings của người dùng.

Tôi nghiêng về **B**.

## 5. Chưa kiểm được

- **SSH/WSL thật**: không có remote server ở máy này. Bằng chứng là bảng §3.1 chạy trên chính glob 1.85
  với URI có authority (`vscode-remote://ssh-remote+build-01:/home/u/notes/readme.md` → `Y`), và
  bằng chứng gián tiếp: check `workbench.editorAssociations decides which editor opens .md` vẫn đọc
  `tuiMarkdown.editor` cho một `file:` URI sau thay đổi. Đây là lý luận trên cùng hàm VS Code đang
  dùng, không phải một phiên remote đã mở.
- **`vscode-vfs:` thật** (virtual workspace github.dev): lý luận như trên, chưa mở workspace ảo nào.
- **`untitled:` gắn đường dẫn liên kết**: chưa tạo được từ extension host (không có API công khai tạo
  untitled-with-associated-resource trên 1.85); bằng chứng là bảng glob §3.1.
- **Diff view của Git Graph** (#48): vẫn là kiểm tra tay, không thay đổi so với trước.

## 6. Câu chữ đề xuất cho tài liệu gốc (điều phối viên áp dụng sau merge)

### CHANGELOG.md, mục `## [Unreleased]`

```md
- Markdown now opens in the WYSIWYG editor only for `file:`, `vscode-remote:` (SSH, WSL,
  Codespaces, Tunnels) and `vscode-vfs:` (virtual workspaces), plus unsaved documents that carry
  a path. Markdown from any other source — a git diff, an extension's virtual document, a PR
  review view — opens in the built-in text editor unless you set `workbench.editorAssociations`
  yourself. This replaces a per-extension denylist that had to grow with every new diff scheme.
  (#169)
```

### README.md

Không có mục nào về diff/Git trong README cần sửa: README mô tả tính năng, không mô tả scheme. Nếu
muốn nói tới hành vi này, thêm vào phần đang nói về lệnh **Choose Default Editor for Markdown in
this Workspace** (dòng ~98):

```md
The choice is written to `workbench.editorAssociations` in the workspace settings,
which is what makes markdown open that way for every source, including the virtual
documents of other extensions. Without it, only files on disk, remote files and
unsaved documents with a path open here.
```

### AGENTS.md

Không có file mới, không có quy ước mới, nhưng có một điều dễ sai lần sau: cơ chế khớp của selector
và cái bẫy `*` không qua dấu `/`. Đề xuất thêm vào mục *Conventions & Gotchas*:

```md
- `contributes.customEditors[].selector` is matched by VS Code 1.85's `globMatchesResource`
  (verified against the 1.85 source), and its rule is the one that makes #169 an allowlist: a
  `filenamePattern` with no `/` in it is matched against the BASENAME, so `*.md` selects markdown
  on EVERY scheme, while `file:/**/*.md` selects it on `file:` only. Two traps inside the scheme
  spelling: `*` does not cross a `/`, so `untitled:/*.md` misses an associated path like
  `untitled:/home/u/notes/readme.md`; and a bare `untitled:Untitled-N` (an unsaved document with
  no path) matches no pattern at all, before or after #169. The `{git,gitlens,git-graph}` denylist
  in `configurationDefaults` is kept as a second layer
```

## 7. Đặc tả floor check đề xuất (ràng buộc 8: tôi không được thêm)

Hai check, cùng một hàm đo. Cần một `TextDocumentContentProvider` cho một scheme lạ (không trùng
scheme nào VS Code đã có), mở nó bằng `vscode.open` (không `openWith`, để đi qua resolver), rồi đọc
`vscode.window.tabGroups.activeTabGroup.activeTab.input.viewType` — nếu là chuỗi thì là custom
editor, nếu chỉ có `uri` thì là text editor. Đây chính xác là probe tôi đã chạy tạm.

1. **`a markdown document from another extension's scheme opens as a text editor`**
   - Thao tác: đăng ký provider `cline` trả về `# hello\n\n…`; `closeAllEditors`; `vscode.open`
     `cline:/notes/readme.md`; chờ ~1.5s; đọc viewType.
   - Khẳng định: viewType KHÔNG phải `tuiMarkdown.editor` (kỳ vọng `text`).
   - Phá gì thì nó đỏ: đổi một selector về `*.md`, hoặc xoá hết khối `selector`. Trước #169 nó đỏ
     ngay với `*.md` (đo được: `cline-noSetting=tuiMarkdown.editor`).

2. **`workbench.editorAssociations does not re-open another scheme in this editor`** (chỉ thêm sau
   khi §4 có quyết định; nếu giữ nguyên hành vi thì KHÔNG thêm, vì nó sẽ đỏ)
   - Thao tác: cùng provider; set workspace `editorAssociations` = `{"*.md": "tuiMarkdown.editor"}`;
     `vscode.open` lại; đọc viewType.
   - Khẳng định: viewType **không** phải `tuiMarkdown.editor` (đây là hành vi sửa được nếu #122 ghi
     association có scheme).
   - Khẳng định phải kèm: sau khi đặt lại association, `file:` vẫn mở `tuiMarkdown.editor` — không
     thì cách chặn đã hỏng hết luôn.

Không thêm check nào cho `untitled:` vì không tạo được untitled-with-associated-resource từ extension
host; đó là lý do §5 ghi "chưa kiểm được".

## 8. Các lệnh kiểm tra trước khi kết thúc (output thật)

```
$ npm run lint
> tui-milkdown-vscode@3.4.2 lint
> tsc --noEmit
(sạch, không in gì thêm)

$ npm run build
> node esbuild.config.js
Building (production)...
Build complete (production)
webview bundle: 1028747 B / 1100000 B budget

$ npm test
ℹ tests 98
ℹ suites 27
ℹ pass 98
ℹ fail 0

$ npm run roundtrip
45 markdown fixtures + 21 seams: 66 passed, 0 failed, 0 missing, 0 errored

$ cp harness/golden/synthetic/*.md harness/fixtures/synthetic/ && npm run roundtrip
45 markdown fixtures + 21 seams: 66 passed, 0 failed, 0 missing, 0 errored
$ git checkout -- harness/fixtures/synthetic/
$ git status --short harness/
(rỗng)

$ PUPPETEER_EXECUTABLE_PATH=$HOME/.cache/puppeteer-floor/chrome-nosandbox \
    xvfb-run -a -s "-screen 0 1920x1080x24" npm run verify:vscode-floor
63 checks: 63 passed, 0 failed
(exit=0)

$ MB=$(git merge-base develop HEAD); git diff $MB..HEAD --stat -- harness/fixtures/synthetic/
(rỗng — không fixture cũ nào bị đụng)
```

Hai check floor mà TASK yêu cầu giữ xanh, ở lượt cuối (sau khi đã gỡ probe):

```
PASS  a diff of two .md files opens as a diff editor, not this custom editor — noSetting=diff "*.md":"tuiMarkdown.editor"=diff; Git Graph's own diff view is NOT covered here and stays a hand check
PASS  workbench.editorAssociations decides which editor opens .md — noSetting=tuiMarkdown.editor "*.md":"default"=text "*.md":"tuiMarkdown.editor"=tuiMarkdown.editor
```

Số ca đỏ của các phép kiểm mới trong báo cáo này: **1/1** (bảng glob phải phân biệt được `**` với
`*`, hàng `untitled://:/home/u/notes/readme.md` cột `[4]` = `.` và cột `[3]` = `Y`; và probe floor
đọc `tuiMarkdown.editor` trước, `text` sau). Không thêm fixture, unit test hay seam nào — thay đổi
nằm trong manifest, không có hàm nào của repo để unit test, và cả hai hành vi nó quyết định đều chỉ
tồn tại trong editor resolver của VS Code.