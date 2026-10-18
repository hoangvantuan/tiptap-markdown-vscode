/**
 * The GitHub-style anchor slug for a heading's text.
 *
 * Lowercase, keep Unicode letters, digits and hyphens, and turn each single
 * whitespace character into one hyphen without collapsing runs. That last part
 * is what GitHub does and what the table of contents already relies on, so a
 * `#anchor` link and the target `scrollToHeading` looks for are the same
 * string by construction rather than by two copies agreeing.
 *
 * Its own module since the H1-H6 level badge plugin it used to share a file
 * with was removed: `scrollToHeading` in main.ts is the only caller, through
 * `fragmentMatchesHeading` below, and a second copy of these three replaces is
 * how the two drift apart.
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
