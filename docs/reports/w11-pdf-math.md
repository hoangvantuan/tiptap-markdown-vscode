# Wave 11 — O1: #168 PDF bookmarks, #179 `markdown.math.macros` into KaTeX (editor part)

Worker: O1 · branch `wave11/o1-pdf-math` · base `f2bd057` (`develop`)

Two issues, one of them split: **#168** is entirely mine, **#179** is the editor half
(the PDF half is out of scope, see "What the PDF does with math today").

Everything below was measured on this machine (Linux, no display). Scripts used for
measurement live in `/tmp/opencode/o1/` and are **not** committed; no dependency was
added to the repository.

---

## 1. #168 — a bookmark tree in the exported PDF

### What changed

| File | Change |
| --- | --- |
| `src/utils/pdf-print.ts` | **NEW.** `printPdf(page, options)`: the one place that calls `page.pdf`, with the experimental options and the fallback. |
| `src/utils/export-pdf.ts` | `page.pdf({...})` → `printPdf(page, {...})`; the module header records the bookmark behaviour. |
| `test/pdf-print.test.ts` | **NEW.** 5 unit tests for the fallback. |

`printPdf` passes `outline: true` and `tagged: true` (both are `PDFOptions` in the
installed `puppeteer-core`, both marked `@experimental` there), and **retries once
without them** if the browser throws. A browser that merely ignores an unknown option
never reaches the retry, so the common "old Chrome" case costs nothing; a browser that
REJECTS the options degrades to "no bookmarks" instead of a failed export.

The module is separate from `export-pdf.ts` on purpose: `export-pdf.ts` requires
`puppeteer-core` at runtime, and importing it from a unit test would pull 2.5 MB of
Chromium bindings into the test bundle. `pdf-print.ts` imports only the *types*
(`import type { PDFOptions } from "puppeteer-core"`), which esbuild erases.

### The `tagged` decision (the issue asked to consider it)

`tagged` is **passed**, and the reason is measured, not assumed: on the floor's browser
(Chrome for Testing 155) Chromium tags by default, so the option is a **no-op** there —
the exported bytes are identical with and without it, and the PDF is tagged either way.
On an older browser it is the difference between a tagged and an untagged PDF, and the
option travels with `outline` through the same fallback, so it can never fail an export.

### Measurement: a real PDF, a real bookmark tree

`node_modules/puppeteer-core/lib/types.d.ts` (the installed version) — the two options
exist and are experimental:

```
$ sed -n 7915,7935p node_modules/puppeteer-core/lib/types.d.ts
   * Generate tagged (accessible) PDF.
   *
   * @defaultValue `true`
   * @experimental
   */
  tagged?: boolean;
  /**
   * Generate document outline.
   *
   * @defaultValue `false`
   * @experimental
   */
  outline?: boolean;
```

The export was driven through the **real** `out/export-pdf.js` (`exportToPdf`, with a
stubbed `vscode` module and `PUPPETEER_EXECUTABLE_PATH` pointing at the floor's
Chrome), on a document with H1–H6. The PDF was read back with `pypdf`
(`~/.venv/tui-milkdown-vscode`, `pypdf==6.21.1`).

**With the change (the real export):**

```
$ node /tmp/opencode/o1/export-run.js <repo> /tmp/opencode/o1/with-outline.pdf
WROTE /tmp/opencode/o1/with-outline.pdf 23990 bytes

$ ~/.venv/tui-milkdown-vscode/bin/python /tmp/opencode/o1/inspect-pdf.py with-outline.pdf
FILE: with-outline.pdf
PAGES: 1
OUTLINE: 2 top-level entries
  OUTLINE depth=0 page=1 title='Chapter One'
  OUTLINE depth=1 page=1 title='Section A'
  OUTLINE depth=2 page=1 title='Subsection A1'
  OUTLINE depth=1 page=1 title='Section B'
  OUTLINE depth=2 page=1 title='Subsection B1'
  OUTLINE depth=3 page=1 title='Heading Four'
  OUTLINE depth=4 page=1 title='Heading Five'
  OUTLINE depth=5 page=1 title='Heading Six'
TEXT:
  page 1: Chapter One | Intro text with a formula $\frac{a}{b}$ and a currency amount $5. | Section A | ...
```

**Teeth — the same document, the same browser, only `outline` removed** (the constant
was emptied, the extension rebuilt, the export re-run):

```
$ node /tmp/opencode/o1/export-run.js <repo> /tmp/opencode/o1/no-outline.pdf
WROTE /tmp/opencode/o1/no-outline.pdf 22628 bytes

$ ~/.venv/tui-milkdown-vscode/bin/python /tmp/opencode/o1/inspect-pdf.py no-outline.pdf
FILE: no-outline.pdf
PAGES: 1
OUTLINE: (empty)
TEXT:
  page 1: Chapter One | Intro text with a formula $\frac{a}{b}$ and a currency amount $5. | Section A | ...
```

The **body text is byte-identical** in both runs: the bookmark tree is Chromium's own
and nothing was injected into the document.

Before the change (the pre-change build, same script):

```
$ ~/.venv/tui-milkdown-vscode/bin/python /tmp/opencode/o1/inspect-pdf.py baseline.pdf
FILE: baseline.pdf
PAGES: 1
OUTLINE: (empty)
```

### Measurement: what the browser does with the options

```
$ REPO=<repo> PUPPETEER_EXECUTABLE_PATH=$HOME/.cache/puppeteer-floor/chrome-nosandbox \
    node /tmp/opencode/o1/pdf-options-probe.js
plain: OK bytes=18324 file=/tmp/opencode/o1/probe-plain.pdf
outline: OK bytes=19207 file=/tmp/opencode/o1/probe-outline.pdf
outline-tagged: OK bytes=19207 file=/tmp/opencode/o1/probe-outline-tagged.pdf
tagged: OK bytes=18324 file=/tmp/opencode/o1/probe-tagged.pdf
bogus: OK bytes=19207 file=/tmp/opencode/o1/probe-bogus.pdf
```

Reading those back:

```
=== probe-plain          OUTLINE: (empty)
=== probe-outline        OUTLINE: 2 top-level entries
                               depth=0 'Chapter One' / depth=1 'Section A' / depth=2 'Subsection A1' …
=== probe-outline-tagged OUTLINE: 2 top-level entries   (same tree)
=== probe-tagged         OUTLINE: (empty)
```

and the tagging question (`/MarkInfo` in the trailer):

```
$ ~/.venv/tui-milkdown-vscode/bin/python - <<'EOF'
...
EOF
probe-plain.pdf MarkInfo: {'/Type': '/MarkInfo', '/Marked': True} StructTreeRoot: True Lang: en-US
probe-tagged.pdf MarkInfo: {'/Type': '/MarkInfo', '/Marked': True} StructTreeRoot: True Lang: en-US
probe-outline.pdf MarkInfo: {'/Type': '/MarkInfo', '/Marked': True} StructTreeRoot: True Lang: en-US
probe-outline-tagged.pdf MarkInfo: {'/Type': '/MarkInfo', '/Marked': True} StructTreeRoot: True Lang: en-US
```

Two facts fall out of this: `tagged` changes **nothing** on a current Chromium
(`plain` is already tagged, and `tagged` produces the same 18324 bytes), and an
**unknown** option (`bogus`) is ignored by Chromium without an error — which is why the
"old Chrome" case degrades to "no bookmarks" rather than to a failure, and why the
retry in `printPdf` is a safety net rather than the main path.

### Teeth for the fallback (unit tests)

`test/pdf-print.test.ts` — 5 cases: the options are passed; a browser that throws is
retried **without** them; the rest of the options survive the retry; a browser that
rejects the plain options too still fails the export; the experimental pair is one
droppable unit.

Break: the retry removed from `printPdf` (the `try/catch` replaced by a direct call):

```
$ npm test
ℹ tests 103
ℹ pass 100
ℹ fail 3
✖ failing tests:
✖ retries without the experimental options when the browser rejects them (0.657483ms)
✖ keeps the rest of the options on the retry (0.462763ms)
✖ still fails the export when the browser rejects the plain options too (2.242756ms)
```

Restored: `ℹ tests 103 / ℹ pass 103 / ℹ fail 0`.

### What the issue asked that is NOT covered here

- "An exported PDF with H1–H3 opens with a bookmark tree in a PDF viewer." — the tree is
  **measured** (pypdf reads the outline of the real exported file). "Opens with a
  bookmark tree in a PDF viewer" itself is a viewer-side fact; I did not open the file in
  a GUI viewer (no display on this machine).
- "No change to the page body" — measured: the extracted text is identical with and
  without `outline`.
- "Bundle size unchanged" — the export is lazy, and the webview bundle is
  **1028747 B → 1029279 B** (+532 B), all of it from #179, not from the export.

---

## 2. #179 — VS Code's `markdown.math.macros` into KaTeX (editor half only)

### What changed

| File | Change |
| --- | --- |
| `src/shared/messages.ts` | `ConfigMessage.mathMacros?: Record<string, string>` (one new field). |
| `src/host/config.ts` | `getMathMacros(document)` reads VS Code's own `markdown.math.macros`; the table is sanitised; `buildConfigMessage` sends it; `handleConfigurationChange` re-sends the config when the setting changes. |
| `src/webview/math-extension.ts` | The macro table, `setMathMacros` / `getMathMacros` / `buildKatexOptions`, and a registry of live node views so a macro change re-renders what is on screen. |
| `src/webview/main.ts` | The `config` message applies the table. |
| `test/math-macros.test.ts` | **NEW.** 13 unit tests (7 host, 6 webview). |

The chain is: `buildConfigMessage` → `ConfigMessage.mathMacros` → the webview's
`config` case → `setMathMacros(...)` → every KaTeX render.

### Why the table is copied

KaTeX **mutates** the object it is given. In `node_modules/katex/dist/katex.js` the
`Namespace` holds the object itself, not a copy:

```js
class Namespace {
  constructor(builtins, globalMacros) {
    …
    this.current = globalMacros;   // the object we passed in
```

and `\gdef` writes into it (`parser.gullet.macros.set(name, …, global)`). So
`buildKatexOptions()` hands KaTeX `{ ...currentMacros }` — a fresh copy per render — and
a `\gdef` in one formula can reach neither the next formula nor the next render of the
same one.

### Why a macro change re-renders what is on screen

The node views register themselves (`registerMathView`) and unregister when
ProseMirror destroys them. `setMathMacros` re-renders the registered views **without
touching the document**, so no `edit` is posted: the LaTeX is a node attribute and the
roundtrip is unaffected (the `math-footnote` golden is unchanged — see the gate below).

Writing the node view's own `dom` from outside a transaction is safe here, and this is
checked in ProseMirror's own source rather than assumed
(`node_modules/prosemirror-view/dist/index.js`):

```js
  ignoreMutation(mutation) {                                    // line 1107
    return !this.contentDOM && mutation.type != "selection";
  }
  …
  ignoreMutation(mutation) {                                    // line 1263 (CustomNodeViewDesc)
    return this.spec.ignoreMutation ? this.spec.ignoreMutation(mutation) : super.ignoreMutation(mutation);
  }
  destroy() {                                                  // line 1266
    if (this.spec.destroy) this.spec.destroy();
  }
```

A math node is an atom with **no** `contentDOM`, so ProseMirror ignores mutations inside
it, and the node view's `destroy()` is called when the view goes away.

### Measurement: the live re-render, in a real ProseMirror view

A throwaway probe (in `/tmp`, not committed) builds a real editor with
`harness/editor.ts` under jsdom, fakes the lazy KaTeX artifact by putting a real KaTeX
on `window.__tuiKatexBundle` (which is exactly where `artifact-bridge.ts` looks for a
loaded artifact), and then changes the macro table:

```
$ ./node_modules/.bin/esbuild /tmp/opencode/o1/math-probe.ts --bundle --platform=node \
    --format=cjs --external:jsdom --banner:js="$(cat /tmp/opencode/o1/banner.js)" \
    --outfile=/tmp/opencode/o1/math-probe.js
$ NODE_PATH=$PWD/node_modules node /tmp/opencode/o1/math-probe.js
1. node view found: true
2. before macros, dom: "<span class=\"katex\"><span class=\"katex-mathml\">…<mstyle mathcolor=\"#cc0000\"><mtext>\RR</mtext>…"
3. markdown before: "Formula $\RR$ here."
4. after macros, dom: "<span class=\"katex\"><span class=\"katex-mathml\">…<mi mathvariant=\"double-struck\">R</mi>…"
5. macros now: {"\\RR":"\\mathbb{R}"}
6. markdown after: "Formula $\RR$ here."
7. re-rendered with the macro: true
8. document untouched: true
```

Before the table arrives `\RR` is a red KaTeX error; after it, the same node view
renders `ℝ` (double-struck R) — **without the document changing**, so nothing is
written back to the file.

### Teeth for the macro tests

`test/math-macros.test.ts` — 13 cases: the host reads the setting; an absent setting
gives an empty table; non-string entries are dropped; an over-long definition is
dropped; the count is capped; the config is re-sent when the setting changes and NOT
re-sent for an unrelated setting; a macro from the table renders; a `\gdef` does not
reach the next formula; a `\gdef` does not reach the next render of the same formula;
KaTeX gets a copy, not the table; a changed table re-renders the live formulas and an
unchanged one does not; a destroyed formula is not re-rendered; the expansion of a
self-referential macro is bounded.

Break 1 — the copy removed (`macros: { ...currentMacros }` → `macros: currentMacros`):

```
$ npm test
ℹ tests 116
ℹ pass 113
ℹ fail 3
✖ failing tests:
✖ keeps a \gdef in one formula out of the next one (3.87293ms)
✖ keeps a \gdef out of the NEXT render of the same formula (1.193982ms)
✖ hands KaTeX a copy of the table, not the table itself (0.66262ms)
```

Break 2 — the re-render removed (the loop over the live views emptied):

```
$ npm test
ℹ tests 116
ℹ pass 115
ℹ fail 1
✖ failing tests:
✖ re-renders the live formulas when the table changes (1.74893ms)
```

Break 3 — the host's filter removed (`out[key] = String(value)` instead of dropping
what is not a string):

```
$ npm test
ℹ tests 116
ℹ pass 114
ℹ fail 2
✖ failing tests:
✖ drops entries that are not strings (4.268708ms)
✖ drops a definition that is too long (1.980648ms)
```

Restored after each break: `ℹ tests 116 / ℹ pass 116 / ℹ fail 0`.

### The untrusted setting

`markdown.math.macros` is **not** our setting: it can come from a workspace settings
file that belongs to somebody else. What is done about that:

- KaTeX macros are pure text substitution — they cannot execute code. The rendering
  keeps `throwOnError: false`, so a broken macro is a red formula, not a crash.
- The table is capped **on the host**: at most 500 macros and 2000 characters per
  definition (`MAX_MATH_MACROS` / `MAX_MATH_MACRO_LENGTH` in `src/host/config.ts`).
  The cap is not arbitrary: KaTeX copies the whole table into every render
  (`new Namespace(src_macros, settings.macros)`), so an unbounded table would slow down
  every formula in the document. Anything dropped is reported in the host log, never
  silently ignored.
- The expansion depth is bounded **in the webview**: `maxExpand: 1000` is KaTeX's own
  default, stated explicitly in `buildKatexOptions()` because the table is not ours.
  It is the knob that stops a self-referential macro from expanding forever
  (KaTeX: "Too many expansions: infinite loop or need to increase maxExpand setting").
- The webview filters again (only string values) — the host is ours, but a message is
  still data.

### What the PDF does with math today (for a separate issue)

The issue body says "Apply to PDF export too". It cannot: **the PDF export does not
render math at all**. Measured on the real export above — the document's
`$\frac{a}{b}$` comes out of the PDF as the literal text `$\frac{a}{b}$`:

```
  page 1: Chapter One | Intro text with a formula $\frac{a}{b}$ and a currency amount $5. | …
```

`grep -rn -i "katex\|remark-math" src/utils/` returns nothing: the export pipeline
(`src/utils/export-pdf.ts` → `unified().use(remarkRehype)`) has no math plugin at all,
so there is nowhere to pass macros to. **No math rendering was added to the PDF** — that
is a separate issue (it needs `remark-math` + `rehype-katex` in the export pipeline, and
then the macro table would have to be threaded through `exportDocument.ts` as well).

### What is NOT verified here

- The macros inside the **real webview** (a VS Code webview, not jsdom): the probe above
  is a real ProseMirror view under jsdom, and the floor check below does not cover
  macros. The floor check spec I propose at the end would.
- That `markdown.math.macros` is **read from the right scope**: the host reads
  `getConfiguration("markdown", document.uri)`, so a per-resource value wins. The unit
  test uses the `vscode` stub, whose `getConfiguration` ignores the scope, so the
  per-resource resolution itself is only VS Code's documented behaviour, not something
  this machine could measure.
- A macro change while the document is open is covered by the unit test and the jsdom
  probe, but not by a floor check.

---

## 3. The gate (all commands run on this worktree, after the last commit)

```
### npm run lint
> tui-milkdown-vscode@3.4.2 lint
> tsc --noEmit
(no output = clean)

### npm run build
Building (production)...
Build complete (production)
webview bundle: 1029279 B / 1100000 B budget

### npm test
ℹ tests 116
ℹ pass 116
ℹ fail 0

### npm run roundtrip
45 markdown fixtures + 21 seams: 66 passed, 0 failed, 0 missing, 0 errored
```

Second round (goldens copied over the fixtures, then restored):

```
$ cp harness/golden/synthetic/*.md harness/fixtures/synthetic/ && npm run roundtrip
45 markdown fixtures + 21 seams: 66 passed, 0 failed, 0 missing, 0 errored
$ git checkout -- harness/fixtures/synthetic/
$ git status --short harness/
(empty)
```

Floor check (the Linux command from `.wave11-spec/COMMON.md`):

```
$ PUPPETEER_EXECUTABLE_PATH=$HOME/.cache/puppeteer-floor/chrome-nosandbox \
    xvfb-run -a -s "-screen 0 1920x1080x24" npm run verify:vscode-floor
…
PASS  export produces a real PDF file — floor-export.pdf bytes=74660 magic=25504446 (expected 25504446)
…
63 checks: 63 passed, 0 failed
```

Fixtures and merge base:

```
$ MB=$(git merge-base develop HEAD); git diff $MB..HEAD --stat -- harness/fixtures/synthetic/
(empty — no fixture was added, changed or removed)
$ git status --short
(empty — everything, this report included, is committed)
```

Baseline for comparison (measured before the first change, on `f2bd057`): lint clean,
bundle 1028747 B, `98 passed, 0 failed`, roundtrip `66 passed, 0 failed`, floor
`63 checks: 63 passed, 0 failed`. The bundle grew by 532 B (all from #179); the test
count grew by 18 (5 + 13).

---

## 4. Wording proposed for the root documents (NOT applied — root `.md` files are off limits)

### `CHANGELOG.md` — under a new `## [Unreleased]` heading

```markdown
## [Unreleased]

### Added

- **An exported PDF now has a bookmark tree.** The export asks Chromium for its native
  outline, so the PDF carries a bookmark for every heading, nested the way the headings
  are. Nothing is injected into the document body: the tree is Chromium's own, and the
  page looks exactly as it did. The bookmark tree and the PDF's accessibility tagging are
  Chromium options that an older Chrome or Edge may not know; those browsers simply
  produce a PDF without bookmarks, and the export never fails because of them.
- **Formulas now use VS Code's own `markdown.math.macros` setting.** A macro defined in
  that setting — `{"\\RR": "\\mathbb{R}"}` — renders in this editor the way it renders in
  VS Code's built-in markdown preview, and the formulas already on screen are redrawn
  when the setting changes. The setting is read from the workspace it applies to, and a
  table that is not ours (a workspace settings file can belong to somebody else) is
  limited in size and in how far a macro may expand.
```

### `README.md` — only if the export section lists what the PDF contains

```markdown
The exported PDF carries a bookmark tree built from the document's headings, so a reader
can jump between sections without a table of contents in the body of the page.
```

### `AGENTS.md` — two additions

In the **File Structure** tree, under `utils/`:

```
│   ├── pdf-print.ts          # The ONE page.pdf call, with Chromium's experimental outline/tagged options and the fallback that drops them
```

In the **Conventions & Gotchas** list:

```markdown
- **A Chromium option the browser does not know is a degradation, never a failure.**
  `outline` and `tagged` are experimental `PDFOptions` (puppeteer-core 24.x) that the
  export asks for: the first gives the PDF a bookmark tree built from the headings, the
  second tags it for accessibility. A browser that ignores an unknown option just
  produces a PDF without bookmarks, and a browser that REJECTS one must not fail the
  export, so `printPdf` in `src/utils/pdf-print.ts` retries once without the pair. The
  module is separate from `export-pdf.ts` so the fallback can be unit tested without
  pulling puppeteer-core into the test bundle
- **KaTeX mutates the `macros` object it is given.** `\gdef` writes into it, so
  `buildKatexOptions()` hands KaTeX a COPY of the table on every render: a `\gdef` in
  one formula must reach neither the next formula nor the next render of the same one.
  A macro change reaches the formulas already on screen through a registry of live node
  views (`registerMathView`), NOT through a transaction: the document must not change,
  or an `edit` would be posted for a document nobody edited
```

---

## 5. Floor check specifications proposed (NOT added — ràng buộc 8)

### 5.1 A PDF export carries a bookmark tree

**Where:** `harness/vscode-floor/extension-tests.ts` (the host half, next to the existing
`export produces a real PDF file` check) and/or `harness/vscode-floor/run.mjs` (the
driver half).

**What it does:**

1. Write a workspace document with an H1, an H2 under it and an H3 under that
   (`# One\n\n## Two\n\n### Three\n`).
2. Drive the export button for `pdf` exactly as the existing
   `export produces a real PDF file` check does, with
   `PUPPETEER_EXECUTABLE_PATH` pointing at the floor's Chrome.
3. Read the produced PDF **as bytes** and look for the outline. There is no PDF parser
   in the repository, so the check should not add one: assert on the raw bytes that the
   file contains the outline title strings and the outline dictionaries, e.g. that
   `/Outlines` and the three heading texts are present in the file, and that the file
   still starts with `%PDF-`.
   (A parser-free check is weaker than pypdf's reading, which is what the report above
   used; if the coordinator prefers, `pypdf` in a python venv is not available inside
   the extension host, so the byte-level check is the realistic floor check.)
4. Also assert the export SUCCEEDED — the file exists, is non-empty and starts with
   `%PDF-`.

**What it asserts:** an exported PDF has a bookmark tree with one entry per heading,
nested by heading level.

**What must make it red:** removing `outline: true` from `EXPERIMENTAL_PDF_OPTIONS`
(the outline disappears → the title strings are missing from the file); making
`printPdf` throw instead of retrying (the export fails → no file at all); a document
with no headings (the file has no outline → the check must not assert one).

### 5.2 A macro change redraws the formula on screen

**Where:** `harness/vscode-floor/run.mjs` (the webview half), next to the existing
`lazy KaTeX artifact loads and renders a formula` check.

**What it does:**

1. Open a document that contains `$\RR$` (an undefined macro) and let the KaTeX
   artifact load. Read the formula's DOM: it must be a KaTeX **error** (KaTeX renders an
   unknown control sequence in red, `color:#cc0000`).
2. Change the setting from the host side — `vscode.workspace.getConfiguration("markdown")
   .update("math.macros", { "\\RR": "\\mathbb{R}" }, ConfigurationTarget.Workspace)` —
   and wait for the webview to receive the new `config` message.
3. Read the formula's DOM again: it must now contain the expansion
   (`mathvariant="double-struck"`, i.e. `ℝ`), and must NOT be red any more.
4. Assert the document on disk is unchanged (`isDirty=false`): the macro change is a
   view change, not an edit.

**What it asserts:** the `config` message reaches the webview, the live math node view is
re-rendered with the new table, and the document is not written to.

**What must make it red:** dropping the `setMathMacros(message.mathMacros)` call in the
webview's `config` case (the formula stays red); passing the shared table instead of a
copy (not observable here — that is the unit test's job); not re-rendering the live
views (the formula stays red even though the table arrived); posting an `edit` for the
macro change (`isDirty=true`).

---

## 6. Files touched

```
$ git diff --stat f2bd057..HEAD
 src/host/config.ts            |  52 ++++++++++
 src/shared/messages.ts         |   6 ++
 src/utils/export-pdf.ts        |   9 +-
 src/utils/pdf-print.ts         |  62 ++++++++++++
 src/webview/main.ts            |   4 +
 src/webview/math-extension.ts  | 137 +++++++++++++++++++++++---
 test/math-macros.test.ts      | 220 ++++++++++++++++++++++++++++++++++++++++++
 test/pdf-print.test.ts         |  94 ++++++++++++++++++
 8 files changed, 567 insertions(+), 17 deletions(-)

$ git log --oneline f2bd057..HEAD
a01d8ca refactor(config): count kept macros instead of re-counting the table
b77e498 feat(math): pass VS Code's markdown.math.macros to KaTeX (#179)
1429221 feat(export-pdf): add Chromium's native PDF bookmark tree (#168)
```

New exported symbols (generated with `grep -n "^export "`):

```
$ grep -n "^export " src/utils/pdf-print.ts src/webview/math-extension.ts
src/utils/pdf-print.ts:31:export const EXPERIMENTAL_PDF_OPTIONS: PDFOptions = {
src/utils/pdf-print.ts:37:export interface PdfPrintTarget {
src/utils/pdf-print.ts:49:export async function printPdf(
src/webview/math-extension.ts:43:export function setMathMacros(macros: unknown): void {
src/webview/math-extension.ts:62:export function getMathMacros(): Record<string, string> {
src/webview/math-extension.ts:74:export function registerMathView(view: { rerender: () => void }): () => void {
src/webview/math-extension.ts:98:export function buildKatexOptions(displayMode: boolean): KatexOptions {
```

The three places the new field travels (generated with `grep -n "mathMacros"`):

```
$ grep -n "mathMacros" src/shared/messages.ts src/host/config.ts src/webview/main.ts
src/shared/messages.ts:155:  mathMacros?: Record<string, string>;
src/host/config.ts:165:    mathMacros: getMathMacros(document),
src/webview/main.ts:1770:      setMathMacros(message.mathMacros);
```
