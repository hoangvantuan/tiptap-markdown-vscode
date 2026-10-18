/**
 * Unit tests for the image name/folder template rules (#172). Pure, no stub.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_IMAGE_FILENAME_TEMPLATE,
  buildTemplateVars,
  checkSaveFolder,
  expandFileName,
  expandTemplate,
  isValidImageFilename,
  normalizeSaveFolder,
  randomBase36,
  sanitizeNameSegment,
  withSuffix,
} from "../src/host/imageName";

const FIXED = new Date(2026, 0, 5, 13, 0, 0); // local 2026-01-05

function vars(documentName = "Notes.md", suggestedName = "photo.png", ext = "png") {
  return buildTemplateVars({
    documentName,
    suggestedName,
    ext,
    now: FIXED,
    random: () => 0.123456789,
    uuid: () => "uuid-1",
  });
}

describe("sanitizeNameSegment (#172)", () => {
  it("leaves an ordinary name alone, spaces and non-ASCII included", () => {
    assert.equal(sanitizeNameSegment("My Notes"), "My Notes");
    assert.equal(sanitizeNameSegment("Ghi chú tuần 3"), "Ghi chú tuần 3");
  });

  it("removes every separator", () => {
    assert.equal(sanitizeNameSegment("a/b"), "a_b");
    assert.equal(sanitizeNameSegment("a\\b"), "a_b");
    assert.equal(sanitizeNameSegment("/etc/passwd"), "_etc_passwd");
  });

  it("leaves no `..` in the result", () => {
    for (const raw of ["..", "a..b", "../x", "...", "x....y", "..\\..\\x"]) {
      const out = sanitizeNameSegment(raw);
      assert.equal(out.includes(".."), false, `${raw} -> ${out}`);
      assert.equal(/[\\/]/.test(out), false, `${raw} -> ${out}`);
    }
  });

  it("replaces a colon and the other Windows-reserved characters", () => {
    assert.equal(sanitizeNameSegment("a:b"), "a_b");
    assert.equal(sanitizeNameSegment('a<b>c"d|e?f*g'), "a_b_c_d_e_f_g");
  });

  it("replaces control characters and the right-to-left override", () => {
    assert.equal(sanitizeNameSegment("a\u0000b\nc"), "a_b_c");
    assert.equal(sanitizeNameSegment("a\u202Eb"), "a_b");
  });

  it("drops trailing dots and spaces, which Windows removes anyway", () => {
    assert.equal(sanitizeNameSegment("name. . "), "name");
  });

  it("prefixes a Windows device name", () => {
    assert.equal(sanitizeNameSegment("CON"), "_CON");
    assert.equal(sanitizeNameSegment("com1"), "_com1");
    assert.equal(sanitizeNameSegment("aux.notes"), "_aux.notes");
    assert.equal(sanitizeNameSegment("console"), "console");
  });

  it("never returns an empty segment", () => {
    assert.equal(sanitizeNameSegment(""), "untitled");
    assert.equal(sanitizeNameSegment("."), "untitled");
    assert.equal(sanitizeNameSegment("   "), "untitled");
  });
});

describe("buildTemplateVars (#172)", () => {
  it("takes fileName from the document name without its extension", () => {
    assert.equal(vars("Notes.md").fileName, "Notes");
    assert.equal(vars("a.b.md").fileName, "a.b");
    assert.equal(vars(".hidden").fileName, ".hidden");
  });

  it("sanitises a document name holding `..`, `:` and `/`", () => {
    const v = vars("we..ird:na/me.md");
    assert.equal(v.fileName, "we_ird_na_me");
  });

  it("formats date as local YYYY-MM-DD and now as epoch milliseconds", () => {
    const v = vars();
    assert.equal(v.date, "2026-01-05");
    assert.equal(v.now, String(FIXED.getTime()));
  });

  it("makes random six base36 characters, even when Math.random prints fewer", () => {
    assert.match(randomBase36(), /^[0-9a-z]{6}$/);
    assert.equal(randomBase36(() => 0.5).length, 6); // 0.5 -> "0.i": two digits after the point
    assert.equal(randomBase36(() => 0), "000000");
  });

  it("passes ext and uuid through", () => {
    const v = vars("a.md", "p.png", "webp");
    assert.equal(v.ext, "webp");
    assert.equal(v.uuid, "uuid-1");
  });
});

describe("expandTemplate / expandFileName (#172)", () => {
  it("expands every variable", () => {
    const r = expandTemplate("${fileName}|${name}|${date}|${now}|${random}|${uuid}|${ext}", vars());
    assert.ok(r.ok);
    assert.equal(r.value, `Notes|photo|2026-01-05|${FIXED.getTime()}|${randomBase36(() => 0.123456789)}|uuid-1|png`);
  });

  it("rejects an unknown variable instead of writing it literally", () => {
    const r = expandTemplate("images/${workspaceDir}/x", vars());
    assert.equal(r.ok, false);
    assert.equal(expandTemplate("${filename}", vars()).ok, false); // wrong case
    assert.equal(expandTemplate("${constructor}", vars()).ok, false);
    assert.equal(expandTemplate("${__proto__}", vars()).ok, false);
  });

  it("does not expand a variable's value a second time", () => {
    const v = { ...vars(), fileName: "${now}" };
    const r = expandTemplate("${fileName}", v);
    assert.ok(r.ok);
    assert.equal(r.value, "${now}");
  });

  it("leaves a lone `$` or `${` alone", () => {
    const r = expandTemplate("cost$5", vars());
    assert.ok(r.ok);
    assert.equal(r.value, "cost$5");
  });

  it("the default template reproduces image-<now>-<6 base36>.<ext>", () => {
    const r = expandFileName(DEFAULT_IMAGE_FILENAME_TEMPLATE, vars());
    assert.ok(r.ok);
    assert.match(r.value, /^image-\d+-[0-9a-z]{6}\.png$/);
  });

  it("appends the extension unless the template spells ${ext}", () => {
    const a = expandFileName("pic", vars());
    const b = expandFileName("pic.${ext}", vars());
    const c = expandFileName("${ext}-pic", vars());
    assert.ok(a.ok && b.ok && c.ok);
    assert.equal(a.value, "pic.png");
    assert.equal(b.value, "pic.png");
    assert.equal(c.value, "png-pic");
  });
});

describe("guards on the expanded result (#172)", () => {
  it("rejects a file name that is not one plain segment", () => {
    for (const bad of ["", "a/b.png", "a\\b.png", "..png", "a..b.png", "a:b.png", "CON.png", "nul", "a\u0000b.png"]) {
      assert.equal(isValidImageFilename(bad), false, JSON.stringify(bad));
    }
    assert.equal(isValidImageFilename("image-1-abc.png"), true);
    assert.equal(isValidImageFilename("My Notes 2026-01-05.png"), true);
  });

  it("rejects an absolute or climbing folder", () => {
    for (const bad of ["/abs", "C:\\x", "C:/x", "..", "../x", "a/../..", "a\\..\\b"]) {
      assert.ok(checkSaveFolder(bad), bad);
    }
    for (const ok of [".", "images", "images/My Notes", "a..b/c"]) {
      assert.equal(checkSaveFolder(ok), undefined, ok);
    }
  });

  it("a sanitised document name cannot push a folder template out of bounds", () => {
    for (const doc of ["..md", "../../etc.md", "a:b.md", "..\\..\\x.md", "/abs.md"]) {
      const r = expandTemplate("images/${fileName}", vars(doc));
      assert.ok(r.ok);
      assert.equal(checkSaveFolder(normalizeSaveFolder(r.value)), undefined, `${doc} -> ${r.value}`);
    }
  });

  it("template text can still spell a bad folder, and the guard catches it", () => {
    const r = expandTemplate("../${fileName}", vars());
    assert.ok(r.ok);
    assert.ok(checkSaveFolder(normalizeSaveFolder(r.value)));
  });
});

describe("normalizeSaveFolder / withSuffix (#172)", () => {
  it("strips trailing separators and maps empty to '.'", () => {
    assert.equal(normalizeSaveFolder("images/"), "images");
    assert.equal(normalizeSaveFolder("images//"), "images");
    assert.equal(normalizeSaveFolder("  a/b  "), "a/b");
    assert.equal(normalizeSaveFolder("/"), ".");
    assert.equal(normalizeSaveFolder("."), ".");
  });

  it("puts the collision suffix before the extension", () => {
    assert.equal(withSuffix("photo.png", 2), "photo-2.png");
    assert.equal(withSuffix("a.b.png", 3), "a.b-3.png");
    assert.equal(withSuffix("noext", 2), "noext-2");
  });
});
