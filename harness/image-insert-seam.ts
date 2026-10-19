/**
 * Image insert seam: the markdown written for an image inserted from a file
 * picker (#173) or downloaded from pasted HTML (#174).
 *
 * Drives src/webview/image-insert.ts against the harness editor, and then
 * serializes the way the webview saves: `editor.getMarkdown()` followed by
 * `transformForSave` with the image map the host reply would have added. So a
 * line here is what lands in the file, not what the node holds.
 *
 * Cases (one `## name` section each):
 *   picker-simple         a picked image becomes `![stem](folder/name.ext)`
 *   picker-space          a path with a space is wrapped in `<...>` (markdown-destination.ts)
 *   picker-space-reload   the file's own `<images/my photo.png>` translates for display and back
 *   picker-anchor-moves   text typed BEFORE the recorded cursor while the dialog
 *                         is open moves the insertion point with it
 *   picker-cancel         a cancelled dialog inserts nothing and frees the anchor
 *   remote-downloaded     one downloaded image has its src replaced by the local
 *                         path, a failed one keeps its URL
 *   remote-duplicate-url  the same URL twice: both nodes are replaced
 *   remote-exact-match    a URL that merely STARTS like the downloaded one is untouched
 *   collect-urls          which `<img src>` of pasted HTML are download candidates
 *
 * Teeth: break `insertImageAt` / `replaceRemoteImageSrc` / the anchor mapping in
 * src/webview/image-insert.ts, or the `<...>` wrapping, and the lines of the
 * cases above change.
 */
import { createHarnessEditor } from "./editor";
import {
  ImageInsertAnchors,
  recordInsertAnchor,
  takeInsertAnchor,
  insertImageAt,
  replaceRemoteImageSrc,
  collectRemoteImageUrls,
} from "../src/webview/image-insert";
import {
  setImageMap,
  mutateImageMap,
  transformForDisplay,
  transformForSave,
} from "../src/webview/image-path-translation";

const FOLDER_URI = "https://file+.vscode-resource.vscode-cdn.net/ws/images";

/** What the webview writes to the file for the editor's current state. */
function savedMarkdown(editor: { getMarkdown: () => string }): string {
  return transformForSave(editor.getMarkdown());
}

/** What main.ts does on an `imagePicked` reply that carries a path. */
function applyPicked(
  editor: Parameters<typeof insertImageAt>[0],
  requestId: string,
  reply: { savedPath: string; webviewUri: string; alt: string },
): boolean {
  const pos = takeInsertAnchor(editor, requestId);
  if (pos === null) return false;
  mutateImageMap((map) => {
    map[reply.savedPath] = reply.webviewUri;
  });
  return insertImageAt(editor, pos, { src: reply.webviewUri, alt: reply.alt });
}

export function runImageInsertSeam(): string {
  const lines: string[] = [
    "image insert seam — markdown written for a picked or downloaded image",
    "each case: the document as it would be saved",
    "",
  ];
  setImageMap({});

  try {
    // Case 1
    {
      lines.push("## picker-simple");
      const { editor, dispose } = createHarnessEditor({
        content: "Before\n",
        extraExtensions: [ImageInsertAnchors],
      });
      try {
        editor.commands.setTextSelection(editor.state.doc.content.size - 1);
        const id = recordInsertAnchor(editor);
        const ok = applyPicked(editor, id, {
          savedPath: "images/photo.png",
          webviewUri: `${FOLDER_URI}/photo.png`,
          alt: "photo",
        });
        lines.push(`inserted: ${ok}`);
        lines.push(`saved: ${JSON.stringify(savedMarkdown(editor))}`);
      } finally {
        dispose();
      }
      lines.push("");
    }

    // Case 2
    {
      lines.push("## picker-space");
      lines.push("# the saved path has a space: the destination must be wrapped in <...>");
      setImageMap({});
      const { editor, dispose } = createHarnessEditor({
        content: "",
        extraExtensions: [ImageInsertAnchors],
      });
      try {
        const id = recordInsertAnchor(editor);
        applyPicked(editor, id, {
          savedPath: "images/my photo.png",
          webviewUri: `${FOLDER_URI}/my%20photo.png`,
          alt: "my photo",
        });
        lines.push(`saved: ${JSON.stringify(savedMarkdown(editor))}`);
      } finally {
        dispose();
      }
      lines.push("");
    }

    // Case 2b
    {
      lines.push("## picker-space-reload");
      lines.push("# the file holds <images/my photo.png>: it must translate for display, and back");
      const map = { "images/my photo.png": `${FOLDER_URI}/my%20photo.png` };
      setImageMap(map);
      const display = transformForDisplay("![my photo](<images/my photo.png>)\n", map);
      lines.push(`display: ${JSON.stringify(display)}`);
      const { editor, dispose } = createHarnessEditor({ content: display });
      try {
        lines.push(`saved: ${JSON.stringify(savedMarkdown(editor))}`);
      } finally {
        dispose();
      }
      lines.push("");
    }

    // Case 3
    {
      lines.push("## picker-anchor-moves");
      lines.push("# cursor after \"he\" in \"hello\"; \"XX\" typed at the start while the dialog is open");
      setImageMap({});
      const { editor, dispose } = createHarnessEditor({
        content: "hello\n",
        extraExtensions: [ImageInsertAnchors],
      });
      try {
        editor.commands.setTextSelection(3);
        const id = recordInsertAnchor(editor);
        editor.view.dispatch(editor.state.tr.insertText("XX", 1));
        applyPicked(editor, id, {
          savedPath: "images/pic.png",
          webviewUri: `${FOLDER_URI}/pic.png`,
          alt: "pic",
        });
        lines.push(`saved: ${JSON.stringify(savedMarkdown(editor))}`);
      } finally {
        dispose();
      }
      lines.push("");
    }

    // Case 4
    {
      lines.push("## picker-cancel");
      lines.push("# dialog cancelled: the host answers with no path");
      setImageMap({});
      const { editor, dispose } = createHarnessEditor({
        content: "hello\n",
        extraExtensions: [ImageInsertAnchors],
      });
      try {
        const before = savedMarkdown(editor);
        const id = recordInsertAnchor(editor);
        const pos = takeInsertAnchor(editor, id);
        lines.push(`anchor taken: ${pos !== null}`);
        lines.push(`anchor taken again: ${takeInsertAnchor(editor, id) !== null}`);
        lines.push(`unchanged: ${savedMarkdown(editor) === before}`);
        lines.push(`saved: ${JSON.stringify(savedMarkdown(editor))}`);
      } finally {
        dispose();
      }
      lines.push("");
    }

    // Case 5
    {
      lines.push("## remote-downloaded");
      lines.push("# a.png downloaded, b.png failed (kept as its remote URL)");
      setImageMap({});
      const { editor, dispose } = createHarnessEditor({
        content:
          "![a](https://cdn.example.com/a.png)\n\n![b](https://cdn.example.com/b.png)\n",
      });
      try {
        lines.push(`before: ${JSON.stringify(savedMarkdown(editor))}`);
        mutateImageMap((map) => {
          map["images/image-1.png"] = `${FOLDER_URI}/image-1.png`;
        });
        const n = replaceRemoteImageSrc(
          editor,
          "https://cdn.example.com/a.png",
          `${FOLDER_URI}/image-1.png`,
        );
        lines.push(`replaced: ${n}`);
        lines.push(`after: ${JSON.stringify(savedMarkdown(editor))}`);
      } finally {
        dispose();
      }
      lines.push("");
    }

    // Case 6
    {
      lines.push("## remote-duplicate-url");
      setImageMap({});
      const { editor, dispose } = createHarnessEditor({
        content:
          "![one](https://cdn.example.com/a.png)\n\n![two](https://cdn.example.com/a.png)\n",
      });
      try {
        mutateImageMap((map) => {
          map["images/image-2.png"] = `${FOLDER_URI}/image-2.png`;
        });
        const n = replaceRemoteImageSrc(
          editor,
          "https://cdn.example.com/a.png",
          `${FOLDER_URI}/image-2.png`,
        );
        lines.push(`replaced: ${n}`);
        lines.push(`after: ${JSON.stringify(savedMarkdown(editor))}`);
      } finally {
        dispose();
      }
      lines.push("");
    }

    // Case 7
    {
      lines.push("## remote-exact-match");
      lines.push("# a.png?v=2 is a different URL from a.png: only the exact one is replaced");
      setImageMap({});
      const { editor, dispose } = createHarnessEditor({
        content:
          "![x](https://cdn.example.com/a.png?v=2)\n\n![y](https://cdn.example.com/a.png)\n",
      });
      try {
        mutateImageMap((map) => {
          map["images/image-3.png"] = `${FOLDER_URI}/image-3.png`;
        });
        const n = replaceRemoteImageSrc(
          editor,
          "https://cdn.example.com/a.png",
          `${FOLDER_URI}/image-3.png`,
        );
        lines.push(`replaced: ${n}`);
        lines.push(`after: ${JSON.stringify(savedMarkdown(editor))}`);
      } finally {
        dispose();
      }
      lines.push("");
    }

    // Case 8
    {
      lines.push("## collect-urls");
      lines.push("# <img src> of pasted HTML: https only, in order, no repeats");
      const html =
        '<p><img src="https://a.example/1.png"> <img src="http://a.example/2.png">' +
        '<img src="data:image/png;base64,AAAA"> <img src="relative/3.png">' +
        '<img src="https://a.example/1.png"><img src=" https://b.example/4.jpg "></p>' +
        '<img alt="no src"><a href="https://a.example/not-an-image">link</a>';
      lines.push(`urls: ${JSON.stringify(collectRemoteImageUrls(html))}`);
      lines.push(`empty: ${JSON.stringify(collectRemoteImageUrls(""))}`);
      lines.push("");
    }
  } finally {
    setImageMap({});
  }

  return lines.join("\n") + "\n";
}
