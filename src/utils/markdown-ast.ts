import type { Code, Image, Paragraph, Parent, Root } from "mdast";

/**
 * Shared MDAST pipeline for DOCX/PDF export.
 *
 * Parsing once in the extension host shares the ordinary markdown structure.
 * Math parsing is opt-in for PDF; DOCX keeps its existing literal-source behavior.
 * Single-line double-dollar formulas at a paragraph start become display math,
 * matching the editor's block rule without changing upstream tokenization.
 */

export async function parseMarkdownToMdast(
  markdown: string,
  options: { math?: boolean } = {},
): Promise<Root> {
  const [{ unified }, { default: remarkParse }, { default: remarkGfm }, { default: remarkFrontmatter }] =
    await Promise.all([
      import("unified"),
      import("remark-parse"),
      import("remark-gfm"),
      import("remark-frontmatter"),
    ]);

  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkFrontmatter, ["yaml", "toml"]);
  if (options.math) {
    const { default: remarkMath } = await import("remark-math");
    processor.use(remarkMath).use(function pdfMathDelimiters() {
      // remark-math installs this processor-local extension through unified's
      // public data API. Wrap only mathText; flow/block math stays upstream.
      const extensions = this.data().micromarkExtensions!;
      const extension = extensions[extensions.length - 1];
      const constructs = extension.text![36]!;
      const original = Array.isArray(constructs) ? constructs[0] : constructs;
      extension.text![36] = {
        ...original,
        tokenize(effects, ok, nok) {
          const start = this.now();
          return original.tokenize.call(this, effects, (code) => {
            const source = this.sliceSerialize({ start, end: this.now() });
            // Reject single-dollar delimiters per InlineMath's rules in
            // webview/math-extension.ts: no edge whitespace/newline, and no
            // digit after the closing $. Upstream still cannot render escaped
            // dollars INSIDE math; those fall back with Markdown's escaping.
            // Reject through micromark's rollback, NOT by restoring MDAST text:
            // '$5; formula $x$' would otherwise swallow x's opening delimiter.
            const closingBackslashes = source.match(/(\\+)\$$/)?.[1].length ?? 0;
            if (!source.startsWith("$$") &&
                (closingBackslashes % 2 === 1 ||
                 !/^\$((?:\\\$|[^\s$\n])(?:(?:\\\$|[^$\n])*?(?:\\\$|[^\s$\n]))?)\$$/.test(source) ||
                 (code !== null && code >= 48 && code <= 57))) {
              return nok(code);
            }
            return ok(code);
          }, nok);
        },
      };
    });
  }
  const mdast = processor.parse(markdown) as Root;
  if (options.math) {
    const { visit, SKIP } = await import("unist-util-visit");
    visit(mdast, "paragraph", (paragraph, index, parent) => {
      const first = paragraph.children[0];
      if (!parent || index === undefined || first?.type !== "inlineMath") return;
      const start = first.position?.start.offset;
      const end = first.position?.end.offset;
      if (start === undefined || end === undefined) return;
      const source = markdown.slice(start, end);
      // remark-math classifies $$...$$ on one line as inline. BlockMath in
      // webview/math-extension.ts accepts it at a block start, with nothing
      // after the closer on that line. Do not promote embedded double dollars
      // or a formula following prose in the same paragraph. Markdown parsing
      // already distinguishes up-to-three-space indentation from indented code.
      if (!/^\$\$[^\r\n]*\$\$$/.test(source) ||
          !/^(?:\r?\n|$)/.test(markdown.slice(end))) return;
      const value = source.slice(2, -2);
      const remaining = paragraph.children.slice(1);
      if (remaining[0]?.type === "text") {
        const text = remaining[0].value.replace(/^\r?\n[ \t]{0,3}/, "");
        if (text) remaining[0] = { ...remaining[0], value: text };
        else remaining.shift();
      }
      parent.children.splice(index, 1, {
        type: "math",
        value,
        position: first.position,
        data: {
          hName: "div",
          hProperties: { className: ["math-display"] },
          hChildren: [{ type: "text", value }],
        },
      }, ...(remaining.length ? [{ type: "paragraph" as const, children: remaining }] : []));
      // Revisit the remainder: consecutive standalone formulas each start a
      // new block, while any intervening prose keeps the remainder inline.
      return [SKIP, index + 1];
    });
  }
  return mdast;
}

/**
 * djb2 hash (32-bit unsigned, hex).
 *
 * Used to correlate mermaid code blocks with pre-rendered images sent from
 * the webview. Normalizes line endings (CRLF/CR), strips zero-width and
 * bidi formatting chars, and applies Unicode NFC so ProseMirror's
 * `node.textContent` and remark-parse's `node.value` hash identically
 * regardless of platform or invisible-char pastes.
 */
export function hashMermaidCode(code: string): string {
  const normalized = code
    .replace(/\r\n?/g, "\n")
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, "")
    .normalize("NFC")
    .trim();
  let h = 5381;
  for (let i = 0; i < normalized.length; i++) {
    h = (h << 5) + h + normalized.charCodeAt(i);
  }
  return (h >>> 0).toString(16);
}

/**
 * Count mermaid code blocks in the tree. Used by the caller to detect
 * when some diagrams did not make it through (render race, parse error,
 * or hash mismatch) and surface a warning.
 */
export function countMermaidBlocks(mdast: Root): number {
  let count = 0;
  walkCodeNodes(mdast, (node) => {
    if (node.lang === "mermaid") count++;
  });
  return count;
}

function walkCodeNodes(root: Root, visit: (node: Code) => void): void {
  const stack: unknown[] = [root];
  while (stack.length) {
    const node = stack.pop() as { type?: string; children?: unknown[] } & Partial<Code>;
    if (!node || typeof node !== "object") continue;
    if (node.type === "code") visit(node as Code);
    if (Array.isArray(node.children)) stack.push(...node.children);
  }
}

/**
 * Walk the tree and swap `code` nodes with lang="mermaid" for
 * `image` nodes pointing at the matching base64 data URL.
 * Mutates in place. Returns the number of blocks successfully replaced.
 *
 * Mermaid blocks without a matching rendered image stay as code
 * blocks (graceful degradation for parse errors in the webview).
 */
export async function replaceMermaidBlocks(
  mdast: Root,
  imageMap: Map<string, string>,
): Promise<number> {
  if (imageMap.size === 0) return 0;

  const { visit, SKIP } = await import("unist-util-visit");

  let replaced = 0;

  visit(mdast, "code", (node: Code, index, parent: Parent | null | undefined) => {
    if (!parent || index === undefined || node.lang !== "mermaid") return;

    const url = imageMap.get(hashMermaidCode(node.value));
    if (!url) return;

    const imageNode: Image = {
      type: "image",
      url,
      alt: "Mermaid Diagram",
    };
    // Wrap in a paragraph so the tree remains schema-valid:
    // `code` is block-level, `image` is phrasing and must live inside a paragraph.
    const paragraphNode: Paragraph = {
      type: "paragraph",
      children: [imageNode],
    };
    parent.children[index] = paragraphNode;
    replaced++;
    return SKIP;
  });

  return replaced;
}

export function stripWikiLinks(mdast: Root): void {
  const WIKI_LINK_RE = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g;

  const stack: unknown[] = [mdast];
  while (stack.length) {
    const node = stack.pop() as { type?: string; value?: string; children?: unknown[] };
    if (!node || typeof node !== "object") continue;

    if (node.type === "text" && typeof node.value === "string" && node.value.includes("[[")) {
      node.value = node.value.replace(WIKI_LINK_RE, (_match, filename, alias) => {
        return alias?.trim() || filename?.trim() || "";
      });
    }

    if (Array.isArray(node.children)) stack.push(...node.children);
  }
}
