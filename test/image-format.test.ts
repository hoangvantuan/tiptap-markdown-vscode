/**
 * Unit tests for the magic-bytes table (#177). Pure, no stub.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { correctExtension, detectImageFormat } from "../src/host/imageFormat";

const bytes = (...b: number[]) => Uint8Array.from(b);
const text = (s: string) => new TextEncoder().encode(s);
const pad = (head: Uint8Array, total = 32) => {
  const out = new Uint8Array(Math.max(total, head.length));
  out.set(head);
  return out;
};

const PNG = pad(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a));
const JPEG = pad(bytes(0xff, 0xd8, 0xff, 0xe0));
const GIF89 = pad(text("GIF89a"));
const GIF87 = pad(text("GIF87a"));
const WEBP = pad(
  bytes(0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20),
);
const SVG = text('<svg xmlns="http://www.w3.org/2000/svg"></svg>');

describe("detectImageFormat (#177)", () => {
  it("recognises each format by its signature", () => {
    assert.equal(detectImageFormat(PNG)?.ext, "png");
    assert.equal(detectImageFormat(JPEG)?.ext, "jpg");
    assert.equal(detectImageFormat(GIF89)?.ext, "gif");
    assert.equal(detectImageFormat(GIF87)?.ext, "gif");
    assert.equal(detectImageFormat(WEBP)?.ext, "webp");
    assert.equal(detectImageFormat(SVG)?.ext, "svg");
  });

  it("does not take a RIFF that is not WebP for WebP (a WAV, say)", () => {
    const wav = pad(bytes(0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x41, 0x56, 0x45));
    assert.equal(detectImageFormat(wav), undefined);
  });

  it("recognises SVG after a BOM and after whitespace", () => {
    assert.equal(detectImageFormat(text("\uFEFF<svg></svg>"))?.ext, "svg");
    assert.equal(detectImageFormat(text("  \n\t<svg></svg>"))?.ext, "svg");
    assert.equal(detectImageFormat(text('\uFEFF \r\n<?xml version="1.0"?><svg/>'))?.ext, "svg");
    assert.equal(detectImageFormat(text('<?xml version="1.0"?>\n<svg/>'))?.ext, "svg");
  });

  it("does not take other text for SVG", () => {
    assert.equal(detectImageFormat(text("<html><svg/></html>")), undefined);
    assert.equal(detectImageFormat(text("hello <svg/>")), undefined);
  });

  it("gives up on empty, short and unknown input without throwing", () => {
    assert.equal(detectImageFormat(new Uint8Array(0)), undefined);
    assert.equal(detectImageFormat(bytes(0x89, 0x50)), undefined);
    assert.equal(detectImageFormat(bytes(0xff, 0xd8)), undefined);
    assert.equal(detectImageFormat(text("BM")), undefined); // BMP: not in the table
  });
});

describe("correctExtension (#177)", () => {
  it("fixes an extension that lies", () => {
    assert.equal(correctExtension("png", WEBP), "webp");
    assert.equal(correctExtension("png", JPEG), "jpg");
    assert.equal(correctExtension("jpg", PNG), "png");
    assert.equal(correctExtension("png", SVG), "svg");
    assert.equal(correctExtension("webp", GIF89), "gif");
  });

  it("leaves an extension that is already right, jpeg and case included", () => {
    assert.equal(correctExtension("jpeg", JPEG), "jpeg");
    assert.equal(correctExtension("jpg", JPEG), "jpg");
    assert.equal(correctExtension("PNG", PNG), "PNG");
    assert.equal(correctExtension("svg", SVG), "svg");
  });

  it("keeps the suggestion when the bytes are not recognised", () => {
    assert.equal(correctExtension("bmp", text("BM......")), "bmp");
    assert.equal(correctExtension("avif", new Uint8Array(0)), "avif");
  });

  it("falls back to png with no suggestion and no recognised bytes", () => {
    assert.equal(correctExtension("", text("???")), "png");
  });

  it("supplies the extension for a suggestion that has none", () => {
    assert.equal(correctExtension("", WEBP), "webp");
  });
});
