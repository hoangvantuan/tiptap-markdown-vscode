/** Real packaged PDF export regression tests (#181), independent of roundtrip.
 * Run: PDF_TEST_PYTHON=/path/to/python-with-pypdf PUPPETEER_EXECUTABLE_PATH=/path/to/chrome npm run test:pdf
 * Requires Chromium and Python with pypdf; missing prerequisites FAIL, never skip.
 * Only VS Code's UI/filesystem boundary is stubbed. Parsing, rendering, fonts,
 * Chromium printing and PDF readback are real; runtime files are staged without node_modules.
 */
import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { mkdtemp, cp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import Module from 'node:module';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const python = process.env.PDF_TEST_PYTHON || 'python3';
let runtime;
let handleExport;
let output;
let macros = {};
const errors = [];
const uri = (fsPath) => ({ fsPath, scheme: 'file' });
const vscode = {
  Uri: { joinPath: (base, ...parts) => uri(path.join(base.fsPath, ...parts)) },
  ProgressLocation: { Notification: 15 },
  window: {
    showSaveDialog: async () => uri(output),
    withProgress: async (_options, action) => action(),
    showInformationMessage: async () => undefined,
    showWarningMessage: async (message) => { throw new Error(message); },
    showErrorMessage: async (message) => { errors.push(message); },
  },
  workspace: {
    fs: { writeFile: (target, bytes) => writeFile(target.fsPath, bytes) },
    getConfiguration: (section) => ({ get: (key, fallback) =>
      section === 'markdown' && key === 'math.macros' ? macros : fallback }),
  },
};
const originalLoad = Module._load;
before(async () => {
  assert.ok(process.env.PUPPETEER_EXECUTABLE_PATH, 'Set PUPPETEER_EXECUTABLE_PATH to Chromium');
  execFileSync(python, ['-c', 'import pypdf'], { stdio: 'pipe' });
  runtime = await mkdtemp(path.join(tmpdir(), 'tui-pdf-test-'));
  for (const name of ['markdown-ast.js', 'export-pdf.js', 'webview/katex']) {
    await cp(path.resolve('out', name), path.join(runtime, name), { recursive: true });
  }
  await build({ entryPoints: ['src/host/exportDocument.ts'], outfile: path.join(runtime, 'host.cjs'),
    bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], logLevel: 'silent' });
  Module._load = function (id, ...args) {
    return id === 'vscode' ? vscode : originalLoad.call(this, id, ...args);
  };
  ({ handleExport } = require(path.join(runtime, 'host.cjs')));
});
after(async () => {
  Module._load = originalLoad;
  if (runtime) await rm(runtime, { recursive: true, force: true });
});

async function exportPdf(markdown, settings = {}) {
  macros = settings;
  errors.length = 0;
  output = path.join(runtime, 'result.pdf');
  await rm(output, { force: true });
  const source = path.join(runtime, 'document.md');
  await writeFile(source, markdown);
  let pending;
  handleExport({ type: 'export', format: 'pdf' },
    { uri: uri(source), getText: () => markdown },
    { postMessage: () => {} },
    (action) => { pending = action(); return true; });
  await pending;
  assert.deepEqual(errors, [], 'export must complete without host errors');
  assert.equal(await readFile(source, 'utf8'), markdown, 'export must not modify its source');
  const bytes = await readFile(output);
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  return JSON.parse(execFileSync(python, ['-c', `
import json, sys
from pypdf import PdfReader
reader = PdfReader(sys.argv[1])
fonts, embedded, links = [], [], []
for page in reader.pages:
    for ref in page['/Resources']['/Font'].get_object().values():
        font = ref.get_object()
        name = str(font.get('/BaseFont', ''))
        fonts.append(name)
        descendant = font.get('/DescendantFonts', [font])[0].get_object()
        descriptor = descendant.get('/FontDescriptor', {}).get_object() if '/FontDescriptor' in descendant else {}
        if any(key in descriptor for key in ['/FontFile', '/FontFile2', '/FontFile3']):
            embedded.append(name)
    for ref in page.get('/Annots', []):
        action = ref.get_object().get('/A', {})
        if '/URI' in action:
            links.append(str(action['/URI']))
print(json.dumps({'text': '\\n'.join(page.extract_text() for page in reader.pages), 'fonts': fonts, 'embedded': embedded, 'links': links}))
`, output], { encoding: 'utf8' }));
}

test('PDF renders inline and block fractions with embedded KaTeX fonts, not literal source', async () => {
  const pdf = await exportPdf(String.raw`Inline $\frac{a}{b}$.

$$
\frac{c}{d}
$$
`);
  assert.doesNotMatch(pdf.text, /\$|\\frac/, pdf.text);
  for (const letter of ['a', 'b', 'c', 'd']) {
    // CSS must hide the parallel MathML representation, not print it twice.
    assert.equal((pdf.text.match(new RegExp('\\b' + letter + '\\b', 'g')) || []).length, 1, pdf.text);
  }
  assert.ok(pdf.embedded.some((font) => font.includes('KaTeX_Math')), JSON.stringify(pdf));
  assert.ok(pdf.fonts.some((font) => font.includes('KaTeX_Math')), JSON.stringify(pdf));
});

test('PDF honours configured macros with per-formula isolation and bounded untrusted expansion', async () => {
  const settings = { '\\RR': '\\mathbb{R}', '\\loop': '\\loop', '\\bad': 12 };
  const pdf = await exportPdf(String.raw`Configured $\RR$.

$$
\RR
$$

$\gdef\RR{Z}\RR$

Still $\RR$.

$\loop$

$\href{https://example.invalid}{unsafe}$
`, settings);
  // KaTeX's AMS font maps the double-struck glyph to 'R' in PDF text.
  assert.equal((pdf.text.match(/\bR\b/g) || []).length, 3, pdf.text);
  assert.match(pdf.text, /Z/, pdf.text);
  assert.doesNotMatch(pdf.text, /\\RR/, pdf.text);
  assert.match(pdf.text, /\\loop/, 'invalid recursive math remains readable without hanging');
  assert.deepEqual(pdf.links, [], 'untrusted math cannot create active PDF links');
  assert.deepEqual(settings, { '\\RR': '\\mathbb{R}', '\\loop': '\\loop', '\\bad': 12 });
  assert.ok(pdf.fonts.some((font) => font.includes('KaTeX_AMS')), JSON.stringify(pdf));
});

test('PDF preserves currency and rejected delimiters without swallowing neighboring math', async () => {
  const pdf = await exportPdf(String.raw`Costs $5 and $10.

Costs $5; formula $x$.

Escaped \$5 and single $7.

Rejected $ z$; valid $y$.

Rejected $w $; valid $v$.

Digit $q$2; valid $t$.
`);
  for (const literal of ['Costs $5 and $10.', 'Costs $5; formula', 'Escaped $5 and single $7.',
    'Rejected $ z$; valid', 'Rejected $w $; valid', 'Digit $q$2; valid']) {
    assert.ok(pdf.text.includes(literal), pdf.text);
  }
  for (const letter of ['x', 'y', 'v', 't']) {
    assert.match(pdf.text, new RegExp('\\b' + letter + '\\b'), pdf.text);
    assert.ok(!pdf.text.includes('$' + letter + '$'), pdf.text);
  }
  assert.ok(pdf.fonts.some((font) => font.includes('KaTeX_Math')), JSON.stringify(pdf));
});

test('unsupported escaped dollars inside inline math fall back literally without swallowing neighboring math', async () => {
  const pdf = await exportPdf(String.raw`Before $\$5$ after, valid $x$ end.`);
  // remark-math does not support escaped dollars in math. Markdown unescapes
  // the literal \\$; preserve the dollars/content rather than losing the formula.
  assert.ok(pdf.text.includes('Before $$5$ after, valid'), pdf.text);
  assert.match(pdf.text, /\bx\b|end\.x$/, pdf.text);
  assert.ok(pdf.text.includes('end.'), pdf.text);
  assert.ok(!pdf.text.includes('$x$'), pdf.text);
  assert.ok(pdf.fonts.some((font) => font.includes('KaTeX_Math')), JSON.stringify(pdf));
});

test('PDF leaves inline code and fenced code literal, including a math language fence', async () => {
  const pdf = await exportPdf('Inline code `$\\frac{e}{f}$`.\n\n```math\n\\frac{g}{h}\n```\n\n```tex\n$\\frac{i}{j}$\n```');
  for (const literal of ['$\\frac{e}{f}$', '\\frac{g}{h}', '$\\frac{i}{j}$']) {
    assert.ok(pdf.text.includes(literal), pdf.text);
  }
  assert.ok(!pdf.fonts.some((font) => font.includes('KaTeX')), JSON.stringify(pdf));
});

test('escaped closing dollars fall back for odd backslashes but real closers after even runs still render', async () => {
  const pdf = await exportPdf(String.raw`Odd $\$x$ after; valid $y$.

Even $z\\$ after.
`);
  assert.ok(pdf.text.includes('Odd $$x$ after; valid'), pdf.text);
  assert.ok(pdf.text.includes('Even') && pdf.text.includes('after.'), pdf.text);
  assert.ok(!pdf.text.includes('$y$') && !pdf.text.includes('$z'), pdf.text);
  assert.match(pdf.text, /\by\b/, pdf.text);
  assert.match(pdf.text, /\bz\b/, pdf.text);
  assert.ok(pdf.embedded.some((font) => font.includes('KaTeX_Math')), JSON.stringify(pdf));
});
