/**
 * Math extensions for Tiptap: InlineMath and BlockMath nodes.
 *
 * LaTeX source is stored as a node attribute ('latex'), parsed via custom MarkedJS
 * tokenizers so that @tiptap/markdown's text escaping never touches the formula (#131).
 *
 * Lazy rendering with KaTeX via artifact-bridge.ts.
 *
 * The macro table (#179) is VS Code's own `markdown.math.macros`, sent by the
 * host in the `config` message. It lives here, at module level, because the
 * KaTeX artifact is loaded lazily and a formula may be rendered long after the
 * config arrived. Two rules the table imposes:
 *
 * - KaTeX MUTATES the `macros` object it is given (`\gdef` writes into it), so
 *   every render gets its own COPY. A `\gdef` in one formula must not reach
 *   the next formula, nor the next render of the same one.
 * - A macro change must reach the formulas already on screen. The node views
 *   register themselves in `liveMathViews` and are re-rendered from there; the
 *   document is NOT touched, so no `edit` is posted (the LaTeX is a node
 *   attribute, and the roundtrip is unaffected either way).
 */
import { Node, mergeAttributes } from "@tiptap/core";
import type { KatexOptions } from "katex";
import { getCachedArtifact, getKatexAssetsUri, loadArtifact } from "./artifact-bridge";

/**
 * The macro table KaTeX renders with. Owned by the host's `config` message;
 * `setMathMacros` is the only writer.
 */
let currentMacros: Record<string, string> = {};

/** The math node views currently on screen, so a macro change can reach them. */
const liveMathViews = new Set<{ rerender: () => void }>();

/**
 * Install the macro table and re-render what is on screen if it changed.
 *
 * The table is copied and filtered: only string values are kept, because the
 * setting can come from a workspace settings file that is not ours, and KaTeX
 * expects strings. The HOST already applies a count and length limit; this is
 * the second, cheap guard against a malformed message.
 */
export function setMathMacros(macros: unknown): void {
  const next: Record<string, string> = {};
  if (macros && typeof macros === "object" && !Array.isArray(macros)) {
    for (const [key, value] of Object.entries(macros as Record<string, unknown>)) {
      if (typeof value === "string") next[key] = value;
    }
  }
  if (sameMacros(next, currentMacros)) return;
  currentMacros = next;
  for (const view of liveMathViews) {
    try {
      view.rerender();
    } catch (err) {
      console.warn("[Math] Could not re-render a formula after a macro change:", err);
    }
  }
}

/** A copy of the current macro table. */
export function getMathMacros(): Record<string, string> {
  return { ...currentMacros };
}

/**
 * Register a formula on screen for re-render, and get the function that
 * unregisters it again.
 *
 * The node views call this when they are created and unregister when
 * ProseMirror destroys them, so a macro change reaches exactly the formulas
 * that are still alive.
 */
export function registerMathView(view: { rerender: () => void }): () => void {
  liveMathViews.add(view);
  return () => {
    liveMathViews.delete(view);
  };
}

function sameMacros(a: Record<string, string>, b: Record<string, string>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => a[key] === b[key]);
}

/**
 * The KaTeX options every render uses.
 *
 * `macros` is a COPY: KaTeX writes `\gdef` definitions into the object it is
 * handed, so the shared table must never be the one a render sees.
 *
 * `maxExpand` is KaTeX's own default (1000), stated explicitly because the
 * table can come from somebody else's workspace settings: it is the knob that
 * stops a self-referential macro from expanding forever.
 */
export function buildKatexOptions(displayMode: boolean): KatexOptions {
  return {
    displayMode,
    throwOnError: false,
    macros: { ...currentMacros },
    maxExpand: 1000,
  };
}

/** Inject KaTeX stylesheet once into webview document.head if not already present. */
export function ensureKatexStylesheet(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById("tui-katex-stylesheet")) return;
  const assetsUri = getKatexAssetsUri();
  if (!assetsUri) return;
  const link = document.createElement("link");
  link.id = "tui-katex-stylesheet";
  link.rel = "stylesheet";
  link.href = `${assetsUri}/katex.min.css`;
  document.head.appendChild(link);
}

/**
 * Inline Math node: $...$
 * Follows GitHub delimiter rules:
 * - Opening $ not followed by whitespace or another $
 * - Closing $ not preceded by whitespace
 * - Closing $ not followed by digit
 * - Does not span newlines
 */
export const InlineMath = Node.create({
  name: "inlineMath",
  group: "inline",
  inline: true,
  atom: true,

  addAttributes() {
    return {
      latex: {
        default: "",
        parseHTML: (el: HTMLElement) => el.getAttribute("data-latex") || "",
        renderHTML: (attrs: { latex?: string }) => ({ "data-latex": attrs.latex || "" }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="inline-math"]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-type": "inline-math",
        class: "inline-math",
      }),
      `$${node.attrs.latex}$`,
    ];
  },

  markdownTokenName: "inlineMath",

  markdownTokenizer: {
    name: "inlineMath",
    level: "inline",
    start(src: string) {
      const match = src.match(/(^|[^\\])\$/);
      return typeof match?.index === "number" ? match.index + (match[1] ? match[1].length : 0) : -1;
    },
    tokenize(src: string) {
      // Delimiter rules:
      // 1. Opening $ not followed by whitespace or $
      // 2. Formula body contains no unescaped $ or newline
      // 3. Closing $ not preceded by whitespace
      // 4. Closing $ not followed by digit
      const match = src.match(/^\$((?:\\\$|[^\s\$\n])(?:(?:\\\$|[^\$\n])*?(?:\\\$|[^\s\$\n]))?)\$(?!\d)/);
      if (!match) return undefined;
      return {
        type: "inlineMath",
        raw: match[0],
        latex: match[1],
        text: match[1],
        tokens: [],
      };
    },
  },

  parseMarkdown(token: any, helpers: any) {
    return helpers.createNode("inlineMath", {
      latex: token.latex ?? token.text ?? "",
    });
  },

  renderMarkdown(node: any) {
    return `$${node.attrs?.latex ?? ""}$`;
  },

  addNodeView() {
    return ({ node }: any) => {
      const dom = document.createElement("span");
      dom.className = "inline-math";
      dom.setAttribute("data-type", "inline-math");
      dom.setAttribute("data-latex", node.attrs.latex || "");

      let currentLatex = node.attrs.latex || "";
      let renderId = 0;

      const render = (latex: string) => {
        const id = ++renderId;
        ensureKatexStylesheet();
        // Built per render, not captured: the macro table can change while
        // the formula is on screen.
        const options = buildKatexOptions(false);

        const cached = getCachedArtifact<{ katex: typeof import("katex") }>("katex");
        if (cached?.katex) {
          try {
            dom.innerHTML = cached.katex.renderToString(latex, options);
            return;
          } catch {
            dom.textContent = `$${latex}$`;
            return;
          }
        }

        dom.textContent = `$${latex}$`;

        loadArtifact<{ katex: typeof import("katex") }>("katex")
          .then((bundle) => {
            if (id !== renderId) return;
            if (bundle?.katex) {
              dom.innerHTML = bundle.katex.renderToString(latex, options);
            }
          })
          .catch(() => {
            if (id === renderId) {
              dom.textContent = `$${latex}$`;
            }
          });
      };

      render(currentLatex);

      // Registered so a macro change can re-render this formula. The node
      // view owns `dom` (an atom has no contentDOM), so writing it here is
      // the same write the update path already does — the document itself is
      // not touched.
      const unregister = registerMathView({ rerender: () => render(currentLatex) });

      return {
        dom,
        update(updatedNode: any) {
          if (updatedNode.type.name !== "inlineMath") return false;
          if (updatedNode.attrs.latex !== currentLatex) {
            currentLatex = updatedNode.attrs.latex || "";
            dom.setAttribute("data-latex", currentLatex);
            render(currentLatex);
          }
          return true;
        },
        destroy() {
          unregister();
        },
      };
    };
  },
});

/**
 * Block Math node: $$...$$
 * Supports single-line and multi-line formulas.
 */
export const BlockMath = Node.create({
  name: "blockMath",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      latex: {
        default: "",
        parseHTML: (el: HTMLElement) => el.getAttribute("data-latex") || "",
        renderHTML: (attrs: { latex?: string }) => ({ "data-latex": attrs.latex || "" }),
      },
      multiline: {
        default: false,
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="block-math"]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "block-math",
        class: "block-math",
      }),
      `$$${node.attrs.latex}$$`,
    ];
  },

  markdownTokenName: "blockMath",

  markdownTokenizer: {
    name: "blockMath",
    level: "block",
    start: () => -1,
    tokenize(src: string) {
      // Matches $$...$$ single-line or multi-line block
      const match = src.match(/^[ \t]{0,3}\$\$([ \t]*\n[\s\S]*?\n[ \t]*|[^\n]*?)\$\$(?:\n+|$)/);
      if (!match) return undefined;
      const rawContent = match[1];
      const isMultiline = rawContent.includes("\n");
      const latex = isMultiline ? rawContent.trim() : rawContent;
      return {
        type: "blockMath",
        raw: match[0],
        latex,
        text: latex,
        multiline: isMultiline,
      };
    },
  },

  parseMarkdown(token: any, helpers: any) {
    return helpers.createNode("blockMath", {
      latex: token.latex ?? token.text ?? "",
      multiline: Boolean(token.multiline),
    });
  },

  renderMarkdown(node: any) {
    const latex = node.attrs?.latex ?? "";
    if (node.attrs?.multiline || latex.includes("\n")) {
      return `$$\n${latex.trim()}\n$$`;
    }
    return `$$${latex}$$`;
  },

  addNodeView() {
    return ({ node }: any) => {
      const dom = document.createElement("div");
      dom.className = "block-math";
      dom.setAttribute("data-type", "block-math");
      dom.setAttribute("data-latex", node.attrs.latex || "");

      let currentLatex = node.attrs.latex || "";
      let renderId = 0;

      const render = (latex: string) => {
        const id = ++renderId;
        ensureKatexStylesheet();
        // Built per render, not captured: the macro table can change while
        // the formula is on screen.
        const options = buildKatexOptions(true);

        const cached = getCachedArtifact<{ katex: typeof import("katex") }>("katex");
        if (cached?.katex) {
          try {
            dom.innerHTML = cached.katex.renderToString(latex, options);
            return;
          } catch {
            dom.textContent = `$$${latex}$$`;
            return;
          }
        }

        dom.textContent = `$$${latex}$$`;

        loadArtifact<{ katex: typeof import("katex") }>("katex")
          .then((bundle) => {
            if (id !== renderId) return;
            if (bundle?.katex) {
              dom.innerHTML = bundle.katex.renderToString(latex, options);
            }
          })
          .catch(() => {
            if (id === renderId) {
              dom.textContent = `$$${latex}$$`;
            }
          });
      };

      render(currentLatex);

      // Registered so a macro change can re-render this formula (see the
      // module header).
      const unregister = registerMathView({ rerender: () => render(currentLatex) });

      return {
        dom,
        update(updatedNode: any) {
          if (updatedNode.type.name !== "blockMath") return false;
          if (updatedNode.attrs.latex !== currentLatex) {
            currentLatex = updatedNode.attrs.latex || "";
            dom.setAttribute("data-latex", currentLatex);
            render(currentLatex);
          }
          return true;
        },
        destroy() {
          unregister();
        },
      };
    };
  },
});

export const mathExtensions = [InlineMath, BlockMath];
