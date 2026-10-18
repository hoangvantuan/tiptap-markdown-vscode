/**
 * `fragmentMatchesHeading`: one comparison for both kinds of link fragment
 * (#170, #171).
 *
 * An Obsidian fragment is heading TEXT (`[[Note#My Heading]]`), a markdown one
 * is the GitHub SLUG (`[x](note.md#my-heading)`). The function slugs both sides
 * with the one rule in heading-slug.ts; these cases check that this really
 * covers both kinds rather than assuming it, and pin the edges around it.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fragmentMatchesHeading, headingSlug } from "../src/webview/heading-slug";

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
