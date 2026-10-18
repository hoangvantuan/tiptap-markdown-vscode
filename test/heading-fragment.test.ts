/**
 * Tests for #170 and #171:
 * 1. `fragmentMatchesHeading`: one slug comparison covering both Obsidian
 *    heading-text fragments and markdown slug fragments.
 * 2. `fragmentNavigation` + `openLocalFileInEditor` + `openWikiLink` +
 *    `dispatchMessage("ready")`: unopened target (queued fragment consumed on
 *    `ready`), already-open target (`scrollTo` posted directly to the open
 *    panel), and text-editor fallback (`findHeadingLine` + `revealRange`).
 * 3. `scrollEditorToHeading` + `ContentSync` on a real Tiptap editor: scrolling
 *    moves the caret into the target heading, scrolls the container, and posts
 *    zero `edit` messages (target document stays clean).
 * 4. `scheduleLatchedScroll`: covered-window `requestAnimationFrame` trap
 *    falls back to the 50 ms timer and runs once.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { Editor } from "@tiptap/core";
import { buildMarkdownExtensions } from "../src/webview/extension-factory";
import {
  fragmentMatchesHeading,
  headingSlug,
  findHeadingOffset,
  scrollEditorToHeading,
  scheduleLatchedScroll,
} from "../src/webview/heading-slug";
import {
  findHeadingLine,
  openWithFragment,
  registerScrollTarget,
  resetFragmentNavigation,
  takePendingFragment,
} from "../src/host/fragmentNavigation";
import { openLocalFileInEditor } from "../src/host/openLocalFile";
import { openWikiLink } from "../src/host/openWikiLink";
import { dispatchMessage, type HandlerContext } from "../src/host/messageHandlers";
import type { EditorSession } from "../src/host/session";
import type { TypedWebview } from "../src/host/typedWebview";
import { ContentSync } from "../src/webview/content-sync";
import {
  setWorkspaceRoot,
  getExecutedCommands,
  resetStub,
} from "./vscode-stub";

describe("fragmentMatchesHeading (#170, #171)", () => {
  const cases: Array<[fragment: string, heading: string, expected: boolean, why: string]> = [
    ["My Heading", "My Heading", true, "Obsidian: heading text"],
    ["my-heading", "My Heading", true, "markdown: GitHub slug"],
    ["my%20heading", "My Heading", true, "percent-encoded text"],
    ["What's new?", "What's new?", true, "text with punctuation"],
    ["whats-new", "What's new?", true, "slug drops punctuation"],
    ["Tiếng Việt", "Tiếng Việt", true, "Unicode text"],
    ["tiếng-việt", "Tiếng Việt", true, "Unicode slug"],
    ["ti%E1%BA%BFng-vi%E1%BB%87t", "Tiếng Việt", true, "percent-encoded Unicode slug"],
    ["100%", "100%", true, "invalid percent-encoding falls back to the raw text"],
    ["Parent#Child", "Child", true, "nested fragment names its last part"],
    ["Parent#Child", "Parent", false, "nested fragment does not name its first part"],
    ["^abc", "abc", false, "a block reference never names a heading"],
    ["!!!", "🎉", false, "a fragment that slugs to nothing matches nothing"],
    ["other", "My Heading", false, "a different heading"],
    ["my-heading-2", "My Heading", false, "no fuzzy or prefix matching"],
  ];

  for (const [fragment, heading, expected, why] of cases) {
    it(`${JSON.stringify(fragment)} vs heading ${JSON.stringify(heading)} -> ${expected} (${why})`, () => {
      assert.equal(fragmentMatchesHeading(fragment, heading), expected);
    });
  }

  it("the slug of a slug is the slug, which is why one comparison covers both kinds", () => {
    for (const text of ["My Heading", "What's new?", "Tiếng Việt", "A  double  space", "C++ & Rust"]) {
      const slug = headingSlug(text);
      assert.equal(headingSlug(slug), slug, `headingSlug is idempotent on ${JSON.stringify(text)}`);
      assert.equal(fragmentMatchesHeading(slug, text), true, `slug of ${JSON.stringify(text)}`);
      assert.equal(fragmentMatchesHeading(text, text), true, `text of ${JSON.stringify(text)}`);
    }
  });
});

describe("findHeadingLine for text editor fallback (#171)", () => {
  const sample = [
    "# Intro",
    "",
    "```markdown",
    "## Fake Heading Inside Fence",
    "```",
    "",
    "## Fake Heading Inside Tilde Fence",
    "~~~",
    "## Still Fake",
    "~~~",
    "",
    "## Real Target ##",
    "",
    "Setext Heading",
    "--------------",
  ].join("\n");

  it("ignores headings inside fenced code blocks and matches ATX and Setext headings", () => {
    assert.equal(findHeadingLine(sample, "Still Fake"), -1);
    assert.equal(findHeadingLine(sample, "Fake Heading Inside Fence"), -1);
    assert.equal(findHeadingLine(sample, "Real Target"), 11);
    assert.equal(findHeadingLine(sample, "real-target"), 11);
    assert.equal(findHeadingLine(sample, "Setext Heading"), 13);
    assert.equal(findHeadingLine(sample, "setext-heading"), 13);
  });
});

describe("cross-file fragment navigation on the host (#171)", () => {
  let tmpDir: string;
  let docDir: string;
  let indexUri: vscode.Uri;
  let indexDoc: vscode.TextDocument;
  let notePath: string;
  let noteUri: vscode.Uri;

  function makeDoc(uri: vscode.Uri, text: string): vscode.TextDocument {
    return {
      uri,
      getText: () => text,
      eol: vscode.EndOfLine.LF,
      positionAt: (offset: number) => new vscode.Position(0, offset),
      isClosed: false,
    } as unknown as vscode.TextDocument;
  }

  function makeWebview() {
    const messages: any[] = [];
    const webview: TypedWebview & { messages: any[] } = {
      messages,
      postMessage: async (msg: any) => {
        messages.push(msg);
        return true;
      },
      asWebviewUri: (u: vscode.Uri) => u,
    } as any;
    return webview;
  }

  beforeEach(() => {
    resetStub();
    resetFragmentNavigation();
    (vscode.window as any).activeTextEditor = undefined;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tuimd-frag-nav-"));
    docDir = path.join(tmpDir, "docs");
    fs.mkdirSync(docDir, { recursive: true });
    const indexPath = path.join(docDir, "index.md");
    notePath = path.join(docDir, "Note.md");
    fs.writeFileSync(indexPath, "# Index\n", "utf8");
    fs.writeFileSync(notePath, "# Intro\n\n## Second Section\n", "utf8");
    indexUri = vscode.Uri.file(indexPath);
    noteUri = vscode.Uri.file(notePath);
    indexDoc = makeDoc(indexUri, "# Index\n");
    setWorkspaceRoot(tmpDir);
  });

  afterEach(() => {
    (vscode.window as any).activeTextEditor = undefined;
    resetFragmentNavigation();
    resetStub();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("unopened target: openWikiLink queues the fragment and target's ready posts scrollTo once", async () => {
    const opened = await openWikiLink("Note#Second Section", indexUri);
    assert.equal(opened?.fsPath, notePath);

    const targetWebview = makeWebview();
    const targetDoc = makeDoc(noteUri, "# Intro\n\n## Second Section\n");
    const session = {
      sendTheme() {},
      sendConfig() {},
      updateWebview() {},
    } as unknown as EditorSession;
    const ctx: HandlerContext = {
      session,
      document: targetDoc,
      webview: targetWebview,
      globalState: { get: () => undefined, update: async () => {} } as any,
      notifyClipboardError: () => {},
    };

    await dispatchMessage({ type: "ready" }, ctx);
    const scrollMsgs = targetWebview.messages.filter((m) => m.type === "scrollTo");
    assert.deepEqual(scrollMsgs, [{ type: "scrollTo", fragment: "Second Section" }]);

    // Consumed once: a second ready must not re-scroll.
    await dispatchMessage({ type: "ready" }, ctx);
    const scrollMsgsAfter = targetWebview.messages.filter((m) => m.type === "scrollTo");
    assert.equal(scrollMsgsAfter.length, 1);
  });

  it("unopened target: openLocalFileInEditor queues markdown #anchor and ignores image #anchor", async () => {
    await openLocalFileInEditor("Note.md#second-section", indexDoc);
    assert.equal(getExecutedCommands().length, 1);
    assert.equal(takePendingFragment(noteUri), "second-section");
    assert.equal(takePendingFragment(noteUri), undefined);

    const svgPath = path.join(docDir, "diagram.svg");
    fs.writeFileSync(svgPath, "<svg/>", "utf8");
    await openLocalFileInEditor("diagram.svg#layer1", indexDoc);
    assert.equal(takePendingFragment(vscode.Uri.file(svgPath)), undefined);
  });

  it("already-open target: openWikiLink and openLocalFileInEditor post scrollTo directly to the open panel", async () => {
    const targetWebview = makeWebview();
    const reg = registerScrollTarget(
      noteUri,
      { active: true, visible: true },
      targetWebview,
    );

    try {
      await openWikiLink("Note#Second Section", indexUri);
      assert.deepEqual(targetWebview.messages, [
        { type: "scrollTo", fragment: "Second Section" },
      ]);
      assert.equal(takePendingFragment(noteUri), undefined, "nothing left pending when delivered directly");

      await openLocalFileInEditor("Note.md#second-section", indexDoc);
      assert.deepEqual(targetWebview.messages, [
        { type: "scrollTo", fragment: "Second Section" },
        { type: "scrollTo", fragment: "second-section" },
      ]);
      assert.equal(takePendingFragment(noteUri), undefined);
    } finally {
      reg.dispose();
    }

    // After the panel is disposed, following a link queues in pendingByDoc again.
    await openLocalFileInEditor("Note.md#after-close", indexDoc);
    assert.equal(takePendingFragment(noteUri), "after-close");
  });

  it("text-editor fallback: reveals the matching heading line when opened in activeTextEditor", async () => {
    const revealed: Array<{ range: vscode.Range; revealType: number }> = [];
    const noteDoc = makeDoc(noteUri, "# Intro\n\n## Second Section\n\nBody\n");
    (vscode.window as any).activeTextEditor = {
      document: noteDoc,
      selection: undefined,
      revealRange(range: vscode.Range, revealType: number) {
        revealed.push({ range, revealType });
      },
    };

    await openWithFragment(noteUri, "second-section");

    assert.equal(revealed.length, 1);
    assert.equal(revealed[0].range.start.line, 2);
    assert.equal(takePendingFragment(noteUri), undefined, "pending fragment cleared after text-editor reveal");
  });
});

describe("webview scrollEditorToHeading, ContentSync clean-state, and latched scheduler (#171)", () => {
  it("finds the first matching heading, scrolls #editor-container, and keeps ContentSync clean (0 edits)", () => {
    // Load jsdom via createRequire so esbuild does not inline jsdom's relative
    // stylesheet read.
    const nodeRequire = createRequire(__filename);
    const { JSDOM } = nodeRequire("jsdom");
    const dom = new JSDOM(
      '<!DOCTYPE html><html><body><div id="editor-container"><div id="editor"></div></div></body></html>',
      { pretendToBeVisual: true, url: "http://localhost/" },
    );
    const prevWindow = (globalThis as any).window;
    const prevDocument = (globalThis as any).document;
    const prevElement = (globalThis as any).Element;
    const prevHTMLElement = (globalThis as any).HTMLElement;
    const prevNode = (globalThis as any).Node;
    const prevRange = (globalThis as any).Range;
    const prevCustomEvent = (globalThis as any).CustomEvent;
    const prevMutationObserver = (globalThis as any).MutationObserver;
    const prevGetComputedStyle = (globalThis as any).getComputedStyle;

    (globalThis as any).window = dom.window;
    (globalThis as any).document = dom.window.document;
    (globalThis as any).Element = dom.window.Element;
    (globalThis as any).HTMLElement = dom.window.HTMLElement;
    (globalThis as any).Node = dom.window.Node;
    (globalThis as any).Range = dom.window.Range;
    (globalThis as any).CustomEvent = dom.window.CustomEvent;
    (globalThis as any).MutationObserver = dom.window.MutationObserver;
    (globalThis as any).getComputedStyle = dom.window.getComputedStyle.bind(dom.window);

    try {
      const markdown = [
        "# First Heading",
        "",
        "Paragraph one.",
        "",
        "## Target Heading!",
        "",
        "Paragraph two.",
        "",
        "## Target Heading!",
        "",
        "> [!NOTE]",
        "> Trailing alert to exercise trailingNode.",
      ].join("\n");

      const posted: string[] = [];
      let editorInstance: any = null;
      const sync = new ContentSync({
        postMessage: (msg) => posted.push(msg.content),
        getEditorBody: () => editorInstance?.getMarkdown() ?? null,
      });

      const scroller = dom.window.document.getElementById("editor-container") as HTMLElement;
      const scrolledCalls: Array<{ top: number; behavior?: ScrollBehavior }> = [];
      scroller.scrollTop = 100;
      scroller.getBoundingClientRect = () => ({ top: 20, left: 0, right: 800, bottom: 620, width: 800, height: 600 } as DOMRect);
      scroller.scrollTo = ((opts: ScrollToOptions) => {
        scrolledCalls.push({ top: opts.top ?? 0, behavior: opts.behavior });
      }) as any;

      editorInstance = new Editor({
        element: dom.window.document.getElementById("editor")!,
        extensions: buildMarkdownExtensions(),
        content: markdown,
        contentType: "markdown",
        onUpdate: () => {
          if (sync.isUpdating()) return;
          sync.debouncedPostEdit();
        },
      });

      try {
        // Mirror main.ts update initialization: inside guardExtensionUpdate,
        // settle trailingNode and anchor baseline.
        sync.guardExtensionUpdate(() => {
          sync.applyHostUpdate(markdown);
          editorInstance.view.dispatch(editorInstance.state.tr.setMeta("addToHistory", false));
          sync.resetContentBaseline();
        });
        assert.equal(sync.hasPendingDebounce(), false, "no debounce after guarded host update");

        // Find the first matching heading and mock its bounding rect so we can
        // verify the exact scrollTop calculation.
        const firstOffset = findHeadingOffset(editorInstance.state.doc, "Target Heading!");
        assert.ok(firstOffset > 0, "should find Target Heading!");
        const headingDom = editorInstance.view.nodeDOM(firstOffset) as HTMLElement;
        headingDom.getBoundingClientRect = () =>
          ({ top: 380, left: 0, right: 800, bottom: 410, width: 800, height: 30 } as DOMRect);

        // 1. Scroll using Obsidian heading text fragment.
        const matchedText = scrollEditorToHeading(editorInstance, "Target Heading!", {
          behavior: "instant",
          guardTransaction: (fn) => sync.guardExtensionUpdate(fn),
          scroller,
        });
        assert.equal(matchedText, true);
        assert.equal(
          editorInstance.state.selection.from,
          firstOffset + 1,
          "caret should move to the start of the FIRST matching heading",
        );
        // targetTop = elRect.top (380) - scrollerRect.top (20) + scroller.scrollTop (100) - 60 = 400
        assert.deepEqual(scrolledCalls, [{ top: 400, behavior: "instant" }]);

        // 2. Scroll using Markdown slug fragment.
        const matchedSlug = scrollEditorToHeading(editorInstance, "target-heading", {
          behavior: "instant",
          guardTransaction: (fn) => sync.guardExtensionUpdate(fn),
          scroller,
        });
        assert.equal(matchedSlug, true);
        assert.equal(editorInstance.state.selection.from, firstOffset + 1);
        assert.equal(scrolledCalls.length, 2);

        // 3. Verify ContentSync did NOT schedule or post any edit (#171).
        assert.equal(sync.hasPendingDebounce(), false, "scrolling must not schedule a debounced edit");
        assert.equal(sync.flushPendingEdit(true), false, "forced flush after scrolling must post nothing");
        assert.deepEqual(posted, [], "scrolling must never dirty the target document");
      } finally {
        editorInstance.destroy();
      }
    } finally {
      (globalThis as any).window = prevWindow;
      (globalThis as any).document = prevDocument;
      (globalThis as any).Element = prevElement;
      (globalThis as any).HTMLElement = prevHTMLElement;
      (globalThis as any).Node = prevNode;
      (globalThis as any).Range = prevRange;
      (globalThis as any).CustomEvent = prevCustomEvent;
      (globalThis as any).MutationObserver = prevMutationObserver;
      (globalThis as any).getComputedStyle = prevGetComputedStyle;
    }
  });

  it("scheduleLatchedScroll fires via 50ms timer when requestAnimationFrame is stalled in a covered window", () => {
    let rafCb: (() => void) | null = null;
    let timerCb: (() => void) | null = null;
    let timerMs = -1;
    let rafCancelled = false;
    let timerCleared = false;
    let runs = 0;

    scheduleLatchedScroll(
      () => {
        runs++;
      },
      {
        requestAnimationFrame: (cb) => {
          rafCb = cb;
          return 11;
        },
        cancelAnimationFrame: (id) => {
          if (id === 11) rafCancelled = true;
        },
        setTimeout: (cb, ms) => {
          timerCb = cb;
          timerMs = ms;
          return 22;
        },
        clearTimeout: (id) => {
          if (id === 22) timerCleared = true;
        },
      },
    );

    assert.equal(timerMs, 50, "fallback timer must be 50ms");
    assert.ok(rafCb && timerCb, "both rAF and setTimeout must be scheduled");

    // Covered window: rAF never fires, 50ms timer fires first.
    timerCb!();
    assert.equal(runs, 1, "50ms fallback must run the scroll callback");
    assert.equal(rafCancelled, true, "winning timer must cancel the pending rAF");

    // If rAF later wakes up, the latch prevents a second run.
    rafCb!();
    assert.equal(runs, 1, "latch must prevent a second execution");
    assert.equal(timerCleared, true);
  });

  it("scheduleLatchedScroll runs on rAF when visible and cancels the 50ms timer", () => {
    let rafCb: (() => void) | null = null;
    let timerCb: (() => void) | null = null;
    let timerCleared = false;
    let runs = 0;

    scheduleLatchedScroll(
      () => {
        runs++;
      },
      {
        requestAnimationFrame: (cb) => {
          rafCb = cb;
          return 1;
        },
        cancelAnimationFrame: () => {},
        setTimeout: (cb) => {
          timerCb = cb;
          return 2;
        },
        clearTimeout: (id) => {
          if (id === 2) timerCleared = true;
        },
      },
    );

    rafCb!();
    assert.equal(runs, 1);
    assert.equal(timerCleared, true, "winning rAF must clear the 50ms fallback timer");
    timerCb!();
    assert.equal(runs, 1);
  });
});
