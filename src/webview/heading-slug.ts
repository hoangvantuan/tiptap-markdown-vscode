/**
 * The GitHub-style anchor slug for a heading's text, and the fragment-to-heading
 * matching and scrolling helpers built on it (#170, #171).
 *
 * Lowercase, keep Unicode letters, digits and hyphens, and turn each single
 * whitespace character into one hyphen without collapsing runs. That last part
 * is what GitHub does and what the table of contents already relies on, so a
 * `#anchor` link and the target `scrollToHeading` looks for are the same
 * string by construction rather than by two copies agreeing.
 *
 * Its own module since the H1-H6 level badge plugin it used to share a file
 * with was removed: `scrollToHeading` in main.ts and `findHeadingLine` in
 * `src/host/fragmentNavigation.ts` both go through `fragmentMatchesHeading`
 * here, so there is still only ONE copy of the slug rule.
 */
export function headingSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s/g, "-");
}

/**
 * Whether a link fragment names the heading whose text is `headingText`.
 *
 * BOTH sides go through `headingSlug`, and that is the whole trick (#170,
 * #171): an Obsidian fragment is the heading's TEXT (`[[Note#My Heading]]`), a
 * markdown fragment is its SLUG (`[x](note.md#my-heading)`), and the slug of a
 * slug is the slug, so one comparison covers both without guessing which kind
 * arrived. Around that:
 * - a percent-encoded fragment (`#my%20heading`) is decoded first, falling back
 *   to the raw string when it is not valid percent-encoding;
 * - an Obsidian nested fragment (`A#B`) names its LAST part, the deepest heading;
 * - a block reference (`^block-id`) never names a heading, even one whose text
 *   happens to slug to `block-id`;
 * - a fragment that slugs to nothing (`#!!!`) matches nothing, rather than the
 *   first heading that also slugs to nothing.
 */
export function fragmentMatchesHeading(fragment: string, headingText: string): boolean {
  let decoded = fragment;
  try {
    decoded = decodeURIComponent(fragment);
  } catch {
    /* not percent-encoded: compare the raw text */
  }
  const last = decoded.split("#").pop() ?? "";
  if (last.trim().startsWith("^")) return false;
  const wanted = headingSlug(last.trim());
  if (wanted === "") return false;
  return headingSlug(headingText) === wanted;
}

/** Minimal ProseMirror-like document shape needed to locate a heading node. */
export interface HeadingSearchDoc {
  descendants(
    callback: (
      node: { type: { name: string }; textContent: string },
      pos: number,
    ) => boolean | void,
  ): void;
}

/**
 * Find the document position of the FIRST heading in `doc` that `fragment`
 * names, or -1 when no heading matches.
 */
export function findHeadingOffset(doc: HeadingSearchDoc, fragment: string): number {
  let target = -1;
  doc.descendants((node, pos) => {
    // Returning false from `descendants` only skips the current node's
    // children, not its siblings; the `target !== -1` check is what makes the
    // first matching heading win.
    if (target !== -1) return false;
    if (node.type.name !== "heading") return;
    if (fragmentMatchesHeading(fragment, node.textContent)) target = pos;
    return false;
  });
  return target;
}

export interface ScrollableHeadingEditor {
  state: { doc: HeadingSearchDoc };
  commands: { setTextSelection(position: number): boolean };
  view: { nodeDOM(pos: number): unknown };
}

export interface ScrollEditorToHeadingOptions {
  behavior?: ScrollBehavior;
  /** Whether to move the caret into the matched heading (default: true). */
  select?: boolean;
  /**
   * Optional wrapper around the selection transaction (in `main.ts`,
   * `contentSync.guardExtensionUpdate`) so a programmatic jump never looks like
   * a user edit to `ContentSync`.
   */
  guardTransaction?: <T>(fn: () => T) => T;
  /** Explicit scroll container; defaults to `#editor-container` in the DOM. */
  scroller?: HTMLElement | null;
}

/**
 * Locate the first heading matching `fragment`, place the caret at its start
 * (`pos + 1`) under `guardTransaction`, and scroll `#editor-container` so the
 * heading sits near the top of the viewport. Returns whether a heading matched.
 */
export function scrollEditorToHeading(
  editor: ScrollableHeadingEditor,
  fragment: string,
  options: ScrollEditorToHeadingOptions = {},
): boolean {
  const target = findHeadingOffset(editor.state.doc, fragment);
  if (target === -1) return false;

  const { behavior = "smooth", select = true, guardTransaction } = options;
  if (select) {
    const applySelection = () => editor.commands.setTextSelection(target + 1);
    if (guardTransaction) {
      guardTransaction(applySelection);
    } else {
      applySelection();
    }
  }

  const dom = editor.view.nodeDOM(target);
  if (dom && typeof (dom as HTMLElement).getBoundingClientRect === "function") {
    const el = dom as HTMLElement;
    const scroller =
      options.scroller !== undefined
        ? options.scroller
        : typeof document !== "undefined"
        ? document.getElementById("editor-container")
        : null;
    if (scroller) {
      const elRect = el.getBoundingClientRect();
      const scrollerRect = scroller.getBoundingClientRect();
      const targetTop = elRect.top - scrollerRect.top + scroller.scrollTop - 60;
      scroller.scrollTo({ top: Math.max(0, targetTop), behavior });
    } else if (typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ behavior, block: "start" });
    }
  }
  return true;
}

export interface LatchedScrollScheduler {
  requestAnimationFrame?: (cb: () => void) => any;
  cancelAnimationFrame?: (id: any) => void;
  setTimeout?: (cb: () => void, ms: number) => any;
  clearTimeout?: (id: any) => void;
}

/**
 * Schedule a load-time or host-triggered scroll with the latched
 * `requestAnimationFrame(once)` + `setTimeout(once, 50)` pair (#112, #171).
 *
 * Chromium does not run `requestAnimationFrame` callbacks while a window is
 * covered or hidden. The 50 ms timer guarantees the scroll still runs once when
 * the window is covered, while a visible window runs on the next frame and
 * cancels the timer. Returns a cancel function that disarms both.
 */
export function scheduleLatchedScroll(
  callback: () => void,
  scheduler?: LatchedScrollScheduler,
): () => void {
  let fired = false;
  let rafId: any = null;
  let timerId: any = null;

  const raf = scheduler?.requestAnimationFrame
    ? (cb: () => void) => scheduler.requestAnimationFrame!(cb)
    : typeof requestAnimationFrame === "function"
    ? (cb: () => void) => requestAnimationFrame(cb)
    : (cb: () => void) => setTimeout(cb, 16);
  const caf = scheduler?.cancelAnimationFrame
    ? (id: any) => scheduler.cancelAnimationFrame!(id)
    : typeof cancelAnimationFrame === "function"
    ? (id: any) => cancelAnimationFrame(id)
    : (id: any) => clearTimeout(id);
  const setT = scheduler?.setTimeout
    ? (cb: () => void, ms: number) => scheduler.setTimeout!(cb, ms)
    : (cb: () => void, ms: number) => setTimeout(cb, ms);
  const clearT = scheduler?.clearTimeout
    ? (id: any) => scheduler.clearTimeout!(id)
    : (id: any) => clearTimeout(id);

  const once = () => {
    if (fired) return;
    fired = true;
    if (rafId !== null) caf(rafId);
    if (timerId !== null) clearT(timerId);
    callback();
  };

  rafId = raf(once);
  timerId = setT(once, 50);

  return () => {
    if (fired) return;
    fired = true;
    if (rafId !== null) caf(rafId);
    if (timerId !== null) clearT(timerId);
  };
}
