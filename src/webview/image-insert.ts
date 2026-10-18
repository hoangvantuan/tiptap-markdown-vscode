/**
 * Image insertion in the webview: where a file-picker image lands (#173) and how
 * a downloaded remote image replaces its `https:` source (#174).
 *
 * Both are answers that arrive LATER than the question: the host replies after a
 * dialog closes or a download finishes, and the document may have moved in the
 * meantime. So neither writes to the DOM or splices markdown text; both are
 * ordinary ProseMirror transactions, which means the change leaves through the
 * normal `onUpdate -> ContentSync.debouncedPostEdit -> postEdit` path and
 * nothing here posts an `edit` of its own.
 *
 * Holding the position (#173). When the dialog is asked for, the cursor
 * position is stored in a plugin state keyed by `requestId`, and the plugin maps
 * every stored position through every later transaction. Text typed or deleted
 * before it while the dialog is open therefore moves the insertion point with
 * the text it was beside, instead of leaving a stale number that points
 * somewhere else in the document. `takeInsertAnchor` removes it; so does a
 * cancelled reply.
 *
 * No VS Code API, so `harness/image-insert-seam.ts` drives it under jsdom.
 */
import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

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

/**
 * The `https:` image URLs in a pasted HTML fragment, in document order and
 * without repeats. Only `<img src>`; `http:`, `data:`, `blob:` and relative
 * sources are not candidates for download. The webview reports these without
 * knowing whether the setting is on: the host decides.
 */
export function collectRemoteImageUrls(html: string): string[] {
  const out: string[] = [];
  if (!html) return out;
  // A <template> parses the fragment inert: its <img> elements never start a
  // load, so scanning pasted HTML cannot itself make a request.
  const template = document.createElement("template");
  template.innerHTML = html;
  for (const img of Array.from(template.content.querySelectorAll("img"))) {
    const src = img.getAttribute("src")?.trim();
    if (src && /^https:\/\//i.test(src) && !out.includes(src)) out.push(src);
  }
  return out;
}
